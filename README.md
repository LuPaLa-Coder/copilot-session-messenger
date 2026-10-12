# Copilot Session Messenger

Cross-session messaging for GitHub Copilot CLI. The plugin discovers other active Copilot sessions
owned by the same operating-system user and exchanges plain-text coordination messages without
copying conversation history or files.

The design mirrors the useful part of Claude Code cross-session messaging:

- discover reachable sessions;
- address a session by name or ID;
- send a text-only message;
- either notify the user or queue the message for the receiving agent.

## Status

This repository contains a local-machine MVP. It supports Linux, macOS, Windows and WSL through
Unix domain sockets or Windows named pipes. Cross-device and cloud delivery are intentionally out
of scope for version `0.2.2`.

## Requirements

- GitHub Copilot CLI with extension support.
- Node.js 20 or later only for running this repository's tests. The extension SDK itself is
  provided by Copilot CLI at runtime.

## Installation

### Install globally from a local checkout

Linux, macOS or WSL:

```bash
sh scripts/install-local.sh
```

Windows PowerShell:

```powershell
.\scripts\install-local.ps1
```

Both scripts copy the runtime files to `~/.copilot/extensions/session-messenger`. Restart Copilot
CLI after installation. When developing inside Copilot CLI, use the extension reload facility
after changing the files.

Do not also create a project-scoped extension with the same name. Copilot CLI loads user and
project extensions independently, and duplicate global tool names cause one copy to fail.

### Install after publishing this repository

Install directly from GitHub:

```bash
copilot plugin install LuPaLa-Coder/copilot-session-messenger
```

Or register it as a marketplace and install by plugin name:

```bash
copilot plugin marketplace add LuPaLa-Coder/copilot-session-messenger
copilot plugin install session-messenger@copilot-session-messenger
```

The marketplace definition is included at `.github/plugin/marketplace.json`.

## Quick start

Open two Copilot CLI sessions after installing the plugin.

In the first session:

```text
Imposta l'alias di questa sessione a backend.
```

In the second:

```text
Elenca le altre sessioni Copilot attive.
Invia alla sessione backend: "Controlla il nuovo contratto dell'endpoint /orders".
```

The receiving session gets a timeline notification. By default the message is also queued as a
prompt so the receiving agent can act on it. Its final response is automatically returned to the
sender as a correlated reply.

## Tools

| Tool | Purpose |
|---|---|
| `session_messenger_list` | Lists active local sessions and their aliases |
| `session_messenger_send` | Sends text using an alias, full session ID, or unique prefix |
| `session_messenger_identity` | Shows the current identity or changes its persistent alias (default: the Copilot session name, else the working folder name plus the first 2 characters of the session ID, e.g. `copilot-session-messenger-ec`) |
| `session_messenger_inbox` | Reads recent messages persisted for the current session |

### Delivery modes

`prompt` is the default and queues the message in the receiving agent session. The content is
clearly marked as untrusted peer input and cannot grant permissions or override safety rules. The
receiving agent's final response is automatically returned to the sender unless `expectReply` is
set to `false`.

`notify` only writes the message to the receiving timeline and inbox. Use it for status updates
that do not require an agent response. Notification-only messages cannot request an automatic
reply.

## Data and state

Runtime state is stored below:

```text
~/.copilot/session-messenger/v1/
  aliases/
  inbox/
  sessions/
```

Socket endpoints are stored in the operating system's temporary directory. Session registry files
are refreshed every 10 seconds and considered stale after 45 seconds.

The plugin does not transfer:

- conversation history;
- files or attachments;
- credentials;
- permission grants;
- memory or instructions.

## Development

No npm dependencies are required.

```bash
npm run validate
```

The validation command runs syntax checks followed by the Node test suite. CI exercises Node.js 20
and 22 on Linux, macOS and Windows.

## Documentation

- [Architecture](docs/architecture.md)
- [Wire protocol](docs/protocol.md)
- [Security model](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Remote relay roadmap](docs/remote-relay.md)
- [Contributing](CONTRIBUTING.md)

## Upstream references

- [Claude Code cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [Copilot CLI extension SDK](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/extensions.md)
- [Creating Copilot CLI plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)

## License

[MIT](LICENSE)
