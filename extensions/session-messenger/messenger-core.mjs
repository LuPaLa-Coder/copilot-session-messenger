import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PROTOCOL_VERSION = 1;
const HEARTBEAT_INTERVAL_MS = 10_000;
const REGISTRY_TTL_MS = 45_000;
const CONNECT_TIMEOUT_MS = 3_000;
const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_WIRE_BYTES = 64 * 1024;
const MAX_INBOX_BYTES = 1024 * 1024;
const RETAINED_INBOX_MESSAGES = 200;

function safeId(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function defaultAlias(sessionId) {
  return `ses-${sessionId.slice(0, 4)}`;
}

async function readSessionName(copilotHome, sessionId) {
  try {
    const yaml = await fs.readFile(
      path.join(copilotHome, "session-state", sessionId, "workspace.yaml"),
      "utf8"
    );
    const match = /^name:[ \t]*(.+)$/m.exec(yaml);
    if (!match) return null;
    let name = match[1].trim();
    if (/^(".*"|'.*')$/.test(name)) name = name.slice(1, -1);
    return name && name.length <= 64 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
  } catch {
    return null;
  }
}

function normalizeAlias(alias) {
  const value = String(alias ?? "").trim();
  if (!value || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Alias must contain 1-64 printable characters.");
  }
  return value;
}

function normalizeMessage(message) {
  const value = String(message ?? "").trim();
  if (!value) throw new Error("Message cannot be empty.");
  if (Buffer.byteLength(value, "utf8") > MAX_MESSAGE_BYTES) {
    throw new Error(`Message exceeds ${MAX_MESSAGE_BYTES} bytes.`);
  }
  return value;
}

function normalizeDelivery(delivery) {
  const value = delivery ?? "prompt";
  if (value !== "notify" && value !== "prompt") {
    throw new Error("Delivery must be either 'notify' or 'prompt'.");
  }
  return value;
}

function normalizeKind(kind) {
  const value = kind ?? "message";
  if (value !== "message" && value !== "reply") {
    throw new Error("Message kind must be either 'message' or 'reply'.");
  }
  return value;
}

function normalizeReplyOptions({ kind, delivery, replyRequested, replyToMessageId }) {
  const normalizedKind = normalizeKind(kind);
  const normalizedReplyTo =
    typeof replyToMessageId === "string" && replyToMessageId.trim()
      ? replyToMessageId.trim()
      : null;
  const normalizedReplyRequested =
    replyRequested === undefined
      ? normalizedKind === "message" && delivery === "prompt"
      : replyRequested;

  if (typeof normalizedReplyRequested !== "boolean") {
    throw new Error("replyRequested must be a boolean.");
  }
  if (normalizedReplyRequested && delivery !== "prompt") {
    throw new Error("Automatic replies require delivery='prompt'.");
  }
  if (normalizedKind === "reply" && !normalizedReplyTo) {
    throw new Error("Reply messages require replyToMessageId.");
  }
  if (normalizedKind === "reply" && normalizedReplyRequested) {
    throw new Error("Reply messages cannot request another automatic reply.");
  }

  return {
    kind: normalizedKind,
    replyRequested: normalizedReplyRequested,
    replyToMessageId: normalizedReplyTo,
  };
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isFreshTimestamp(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && now - timestamp <= REGISTRY_TTL_MS;
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await fs.lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`State path is not a real directory: ${directory}`);
  }
  if (process.platform !== "win32") await fs.chmod(directory, 0o700);
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  if (process.platform === "win32") await fs.rm(file, { force: true });
  await fs.rename(temporary, file);
  if (process.platform !== "win32") await fs.chmod(file, 0o600);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function publicSession(entry, currentSessionId) {
  return {
    sessionId: entry.sessionId,
    alias: entry.alias,
    cwd: entry.cwd,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    current: entry.sessionId === currentSessionId,
  };
}

async function readRegistryEntries(sessionsDirectory) {
  let names;
  try {
    names = await fs.readdir(sessionsDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const entries = [];
  const now = Date.now();
  await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const file = path.join(sessionsDirectory, name);
        const entry = await readJson(file);
        if (
          !entry ||
          entry.protocol !== PROTOCOL_VERSION ||
          typeof entry.sessionId !== "string" ||
          typeof entry.alias !== "string" ||
          typeof entry.endpoint !== "string" ||
          typeof entry.token !== "string" ||
          !isProcessAlive(entry.pid) ||
          !isFreshTimestamp(entry.updatedAt, now)
        ) {
          await fs.rm(file, { force: true });
          return;
        }
        entries.push(entry);
      })
  );
  return entries;
}

function resolveTarget(entries, target) {
  const wanted = String(target ?? "").trim().toLowerCase();
  if (!wanted) throw new Error("Target session is required.");

  const exact = entries.filter(
    (entry) =>
      entry.sessionId.toLowerCase() === wanted || entry.alias.toLowerCase() === wanted
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`Target '${target}' is ambiguous: ${exact.map((x) => x.alias).join(", ")}.`);
  }

  const prefix = entries.filter(
    (entry) =>
      entry.sessionId.toLowerCase().startsWith(wanted) ||
      entry.alias.toLowerCase().startsWith(wanted)
  );
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) {
    throw new Error(`Target '${target}' is ambiguous: ${prefix.map((x) => x.alias).join(", ")}.`);
  }
  throw new Error(`No active session matches '${target}'.`);
}

// macOS tmpdir() paths exceed the ~103-byte sun_path limit of Unix sockets.
function defaultSocketRoot() {
  return process.platform === "darwin" ? "/tmp" : os.tmpdir();
}

function endpointFor(sessionId, socketDirectory) {
  const id = safeId(sessionId);
  if (process.platform === "win32") return `\\\\.\\pipe\\copilot-session-messenger-${id}`;
  return path.join(socketDirectory, `${id}.sock`);
}

function sendRequest(endpoint, request, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let settled = false;
    let received = "";

    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(response);
    };

    const timer = setTimeout(
      () => finish(new Error(`Timed out connecting to session after ${timeoutMs} ms.`)),
      timeoutMs
    );

    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      received += chunk;
      if (Buffer.byteLength(received, "utf8") > MAX_WIRE_BYTES) {
        finish(new Error("Response exceeded the wire-size limit."));
        return;
      }
      const newline = received.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(received.slice(0, newline));
        if (!response.ok) finish(new Error(response.error || "Target rejected the message."));
        else finish(null, response);
      } catch {
        finish(new Error("Target returned an invalid response."));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => {
      if (!settled) finish(new Error("Target closed the connection without a response."));
    });
  });
}

async function appendInbox(inboxFile, message) {
  await fs.appendFile(inboxFile, `${JSON.stringify(message)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") await fs.chmod(inboxFile, 0o600);

  const stats = await fs.stat(inboxFile);
  if (stats.size <= MAX_INBOX_BYTES) return;

  const lines = (await fs.readFile(inboxFile, "utf8"))
    .split("\n")
    .filter(Boolean)
    .slice(-RETAINED_INBOX_MESSAGES);
  await fs.writeFile(inboxFile, `${lines.join("\n")}\n`, { mode: 0o600 });
}

async function readInboxFile(inboxFile, limit) {
  let content;
  try {
    content = await fs.readFile(inboxFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  return content
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

function parseInboundRequest(line, token, sessionId) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    throw new Error("Invalid JSON request.");
  }
  if (request.protocol !== PROTOCOL_VERSION) throw new Error("Unsupported protocol version.");

  const providedToken = Buffer.from(String(request.token));
  const expectedToken = Buffer.from(token);
  if (
    providedToken.length !== expectedToken.length ||
    !crypto.timingSafeEqual(providedToken, expectedToken)
  ) {
    throw new Error("Authentication failed.");
  }
  if (request.to !== sessionId) throw new Error("Message addressed to a different session.");

  const delivery = normalizeDelivery(request.delivery);
  const replyOptions = normalizeReplyOptions({
    kind: request.kind,
    delivery,
    replyRequested: request.replyRequested,
    replyToMessageId: request.replyToMessageId,
  });

  return {
    id: typeof request.id === "string" ? request.id : crypto.randomUUID(),
    ...replyOptions,
    from: {
      sessionId: String(request.from?.sessionId ?? "unknown"),
      alias: String(request.from?.alias ?? "unknown"),
      cwd: String(request.from?.cwd ?? ""),
    },
    to: sessionId,
    message: normalizeMessage(request.message),
    delivery,
    sentAt: String(request.sentAt ?? new Date().toISOString()),
    receivedAt: new Date().toISOString(),
  };
}

function reportError(handler, error) {
  if (!handler) return;
  Promise.resolve(handler(error)).catch(() => {});
}

export async function startPeer(options) {
  const sessionId = String(options.sessionId ?? "").trim();
  if (!sessionId) throw new Error("sessionId is required.");

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const stateRoot =
    options.stateRoot ??
    path.join(process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"), "session-messenger");
  const sessionsDirectory = path.join(stateRoot, "v1", "sessions");
  const inboxDirectory = path.join(stateRoot, "v1", "inbox");
  const aliasesDirectory = path.join(stateRoot, "v1", "aliases");
  const socketDirectory =
    options.socketDirectory ??
    path.join(defaultSocketRoot(), `copilot-session-messenger-${process.getuid?.() ?? os.userInfo().username}`);
  const registryFile = path.join(sessionsDirectory, `${safeId(sessionId)}.json`);
  const inboxFile = path.join(inboxDirectory, `${safeId(sessionId)}.jsonl`);
  const aliasFile = path.join(aliasesDirectory, `${safeId(sessionId)}.json`);
  const endpoint = endpointFor(sessionId, socketDirectory);
  const token = crypto.randomBytes(32).toString("hex");
  const startedAt = new Date().toISOString();
  let stopped = false;

  await Promise.all([
    ensurePrivateDirectory(sessionsDirectory),
    ensurePrivateDirectory(inboxDirectory),
    ensurePrivateDirectory(aliasesDirectory),
    process.platform === "win32" ? Promise.resolve() : ensurePrivateDirectory(socketDirectory),
  ]);

  const savedIdentity = await readJson(aliasFile);
  const copilotHome = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
  let followSessionName = options.alias === undefined && !savedIdentity?.alias;
  let alias = normalizeAlias(
    options.alias ??
      savedIdentity?.alias ??
      (await readSessionName(copilotHome, sessionId)) ??
      defaultAlias(sessionId)
  );

  if (process.platform !== "win32") await fs.rm(endpoint, { force: true });

  const registryEntry = () => ({
    protocol: PROTOCOL_VERSION,
    sessionId,
    alias,
    cwd,
    pid: process.pid,
    endpoint,
    token,
    startedAt,
    updatedAt: new Date().toISOString(),
  });

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let received = "";
    let processing = false;
    let replied = false;

    const reply = (payload) => {
      if (replied) return;
      replied = true;
      socket.end(`${JSON.stringify(payload)}\n`);
    };

    socket.on("data", async (chunk) => {
      received += chunk;
      if (Buffer.byteLength(received, "utf8") > MAX_WIRE_BYTES) {
        reply({ ok: false, error: "Request exceeded the wire-size limit." });
        return;
      }
      const newline = received.indexOf("\n");
      if (newline < 0 || processing || replied) return;
      processing = true;

      try {
        const message = parseInboundRequest(received.slice(0, newline), token, sessionId);
        await appendInbox(inboxFile, message);
        reply({ ok: true, messageId: message.id, receivedAt: message.receivedAt });
        try {
          const delivery = options.onMessage?.(message);
          Promise.resolve(delivery).catch((error) => reportError(options.onError, error));
        } catch (error) {
          reportError(options.onError, error);
        }
      } catch (error) {
        reply({ ok: false, error: error?.message || String(error) });
      }
    });
    socket.on("error", (error) => reportError(options.onError, error));
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });

  try {
    await writeJsonAtomic(registryFile, registryEntry());
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    if (process.platform !== "win32") await fs.rm(endpoint, { force: true });
    throw error;
  }

  const heartbeat = setInterval(async () => {
    if (followSessionName) {
      const name = await readSessionName(copilotHome, sessionId);
      if (name) alias = name;
    }
    writeJsonAtomic(registryFile, registryEntry()).catch((error) =>
      reportError(options.onError, error)
    );
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  async function listSessions({ includeCurrent = true } = {}) {
    const entries = await readRegistryEntries(sessionsDirectory);
    return entries
      .filter((entry) => includeCurrent || entry.sessionId !== sessionId)
      .map((entry) => publicSession(entry, sessionId))
      .sort((left, right) => left.alias.localeCompare(right.alias));
  }

  async function sendMessage({
    target,
    message,
    delivery,
    kind,
    replyRequested,
    replyToMessageId,
  }) {
    const entries = await readRegistryEntries(sessionsDirectory);
    const recipient = resolveTarget(entries, target);
    const normalizedDelivery = normalizeDelivery(delivery);
    const replyOptions = normalizeReplyOptions({
      kind,
      delivery: normalizedDelivery,
      replyRequested,
      replyToMessageId,
    });
    const payload = {
      protocol: PROTOCOL_VERSION,
      token: recipient.token,
      id: crypto.randomUUID(),
      ...replyOptions,
      from: { sessionId, alias, cwd },
      to: recipient.sessionId,
      message: normalizeMessage(message),
      delivery: normalizedDelivery,
      sentAt: new Date().toISOString(),
    };
    const response = await sendRequest(recipient.endpoint, payload, options.connectTimeoutMs);
    return {
      messageId: response.messageId,
      receivedAt: response.receivedAt,
      target: publicSession(recipient, sessionId),
      delivery: payload.delivery,
      replyRequested: payload.replyRequested,
    };
  }

  async function setAlias(nextAlias) {
    alias = normalizeAlias(nextAlias);
    followSessionName = false;
    await writeJsonAtomic(aliasFile, { sessionId, alias });
    await writeJsonAtomic(registryFile, registryEntry());
    return { sessionId, alias, cwd };
  }

  async function readInbox({ limit = 20 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return readInboxFile(inboxFile, boundedLimit);
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    await new Promise((resolve) => server.close(resolve));
    const current = await readJson(registryFile);
    if (current?.token === token) await fs.rm(registryFile, { force: true });
    if (process.platform !== "win32") await fs.rm(endpoint, { force: true });
  }

  return {
    identity: () => ({ sessionId, alias, cwd, startedAt }),
    listSessions,
    sendMessage,
    setAlias,
    readInbox,
    stop,
  };
}

export const limits = {
  registryTtlMs: REGISTRY_TTL_MS,
  maxMessageBytes: MAX_MESSAGE_BYTES,
  maxWireBytes: MAX_WIRE_BYTES,
};
