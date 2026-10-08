import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  limits,
  startPeer,
} from "../extensions/session-messenger/messenger-core.mjs";

// Short base path: macOS tmpdir() would exceed the Unix socket path limit.
function makeTempRoot(prefix) {
  return fs.mkdtemp(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), prefix));
}

async function withPeers(run) {
  const root = await makeTempRoot("sm-test-");
  const socketDirectory = path.join(root, "sockets");
  const received = [];
  const peers = [];

  try {
    const suffix = `${process.pid}-${Date.now()}-${Math.random()}`;
    const alpha = await startPeer({
      sessionId: `alpha-${suffix}`,
      alias: "alpha",
      cwd: path.join(root, "alpha"),
      stateRoot: root,
      socketDirectory,
      onMessage: async (message) => received.push(message),
    });
    peers.push(alpha);

    const beta = await startPeer({
      sessionId: `beta-${suffix}`,
      alias: "beta",
      cwd: path.join(root, "beta"),
      stateRoot: root,
      socketDirectory,
    });
    peers.push(beta);

    await run({ alpha, beta, received, root, socketDirectory });
  } finally {
    await Promise.allSettled(peers.map((peer) => peer.stop()));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("discovers peers and identifies the current session", async () => {
  await withPeers(async ({ alpha }) => {
    const sessions = await alpha.listSessions();
    assert.equal(sessions.length, 2);
    assert.equal(sessions.find((item) => item.alias === "alpha").current, true);
    assert.equal(sessions.find((item) => item.alias === "beta").current, false);
  });
});

test("sends authenticated messages by alias and persists them in the inbox", async () => {
  await withPeers(async ({ alpha, beta, received }) => {
    const result = await beta.sendMessage({
      target: "alpha",
      message: "Please check the API contract.",
      delivery: "prompt",
    });

    assert.equal(result.target.alias, "alpha");
    assert.equal(result.delivery, "prompt");
    assert.equal(result.replyRequested, true);
    assert.equal(received.length, 1);
    assert.equal(received[0].kind, "message");
    assert.equal(received[0].replyRequested, true);
    assert.equal(received[0].from.alias, "beta");
    assert.equal(received[0].message, "Please check the API contract.");

    const inbox = await alpha.readInbox();
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].id, received[0].id);
  });
});

test("supports alias changes, persistence, and unambiguous prefixes", async () => {
  await withPeers(async ({ alpha, beta, received, root, socketDirectory }) => {
    await alpha.setAlias("backend-review");
    const sessions = await beta.listSessions({ includeCurrent: false });
    assert.equal(sessions[0].alias, "backend-review");

    await beta.sendMessage({
      target: "backend",
      message: "Status?",
      delivery: "notify",
    });
    assert.equal(received[0].delivery, "notify");
    assert.equal(received[0].replyRequested, false);

    const identity = alpha.identity();
    await alpha.stop();
    const resumed = await startPeer({
      sessionId: identity.sessionId,
      cwd: identity.cwd,
      stateRoot: root,
      socketDirectory,
    });
    try {
      assert.equal(resumed.identity().alias, "backend-review");
    } finally {
      await resumed.stop();
    }
  });
});

test("rejects empty and oversized messages", async () => {
  await withPeers(async ({ beta }) => {
    await assert.rejects(
      beta.sendMessage({ target: "alpha", message: "   " }),
      /cannot be empty/
    );
    await assert.rejects(
      beta.sendMessage({ target: "alpha", message: "x".repeat(33 * 1024) }),
      /exceeds/
    );
    await assert.rejects(
      beta.sendMessage({
        target: "alpha",
        message: "Reply required",
        delivery: "notify",
        replyRequested: true,
      }),
      /require delivery='prompt'/
    );
  });
});

test("correlates replies without requesting another reply", async () => {
  await withPeers(async ({ alpha, beta }) => {
    const request = await beta.sendMessage({
      target: "alpha",
      message: "What changed?",
      delivery: "prompt",
    });

    await alpha.sendMessage({
      target: "beta",
      message: "The API contract changed.",
      delivery: "notify",
      kind: "reply",
      replyToMessageId: request.messageId,
      replyRequested: false,
    });

    const inbox = await beta.readInbox();
    assert.equal(inbox[0].kind, "reply");
    assert.equal(inbox[0].replyToMessageId, request.messageId);
    assert.equal(inbox[0].replyRequested, false);
    assert.equal(inbox[0].message, "The API contract changed.");
  });
});

test("rejects replies without correlation metadata", async () => {
  await withPeers(async ({ beta }) => {
    await assert.rejects(
      beta.sendMessage({
        target: "alpha",
        message: "Uncorrelated reply",
        delivery: "notify",
        kind: "reply",
      }),
      /require replyToMessageId/
    );
  });
});

test("assigns a short default alias derived from the session ID", async () => {
  const root = await makeTempRoot("sm-default-");
  const peer = await startPeer({
    sessionId: "fc6e0e4b-4f26-40d1-8634-e5068530a85b",
    cwd: path.join(root, "some-very-long-project-name"),
    stateRoot: root,
    socketDirectory: path.join(root, "sockets"),
  });
  try {
    assert.equal(peer.identity().alias, "ses-fc6e");
  } finally {
    await peer.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects ambiguous aliases", async () => {
  const root = await makeTempRoot("sm-ambiguous-");
  const socketDirectory = path.join(root, "sockets");
  const peers = [];
  try {
    const suffix = `${process.pid}-${Date.now()}-${Math.random()}`;
    for (const [id, alias] of [
      ["one", "api-one"],
      ["two", "api-two"],
      ["sender", "sender"],
    ]) {
      peers.push(
        await startPeer({
          sessionId: `${id}-${suffix}`,
          alias,
          cwd: path.join(root, id),
          stateRoot: root,
          socketDirectory,
        })
      );
    }

    await assert.rejects(
      peers[2].sendMessage({ target: "api", message: "Hello" }),
      /ambiguous/
    );
  } finally {
    await Promise.allSettled(peers.map((peer) => peer.stop()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects requests when the registry authentication token is tampered with", async () => {
  await withPeers(async ({ beta, root }) => {
    const sessionsDirectory = path.join(root, "v1", "sessions");
    const files = await fs.readdir(sessionsDirectory);
    for (const file of files) {
      const fullPath = path.join(sessionsDirectory, file);
      const entry = JSON.parse(await fs.readFile(fullPath, "utf8"));
      if (entry.alias !== "alpha") continue;
      entry.token = "0".repeat(entry.token.length);
      await fs.writeFile(fullPath, `${JSON.stringify(entry)}\n`);
    }

    await assert.rejects(
      beta.sendMessage({ target: "alpha", message: "This must be rejected." }),
      /Authentication failed/
    );
  });
});

test("removes stale registry entries even when their pid is alive", async () => {
  await withPeers(async ({ alpha, root }) => {
    const sessionsDirectory = path.join(root, "v1", "sessions");
    const staleFile = path.join(sessionsDirectory, "stale.json");
    await fs.writeFile(
      staleFile,
      `${JSON.stringify({
        protocol: 1,
        sessionId: "stale-session",
        alias: "stale",
        cwd: root,
        pid: process.pid,
        endpoint: "unused",
        token: "unused",
        startedAt: new Date(0).toISOString(),
        updatedAt: new Date(Date.now() - limits.registryTtlMs - 1_000).toISOString(),
      })}\n`
    );

    const sessions = await alpha.listSessions();
    assert.equal(sessions.some((item) => item.alias === "stale"), false);
    await assert.rejects(fs.access(staleFile), /ENOENT/);
  });
});
