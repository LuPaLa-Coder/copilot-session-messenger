# Local wire protocol

## Transport

- Unix-like systems: Unix domain socket.
- Windows: named pipe.
- Framing: one UTF-8 JSON object followed by `\n`.
- Maximum request or response size: 64 KiB.
- Protocol version: `1`.

## Registry entry

Registry files are JSON documents under `~/.copilot/session-messenger/v1/sessions`.

```json
{
  "protocol": 1,
  "sessionId": "session UUID",
  "alias": "backend",
  "cwd": "/workspace/project",
  "pid": 12345,
  "endpoint": "/tmp/copilot-session-messenger-1000/hash.sock",
  "token": "random 256-bit hexadecimal token",
  "startedAt": "2026-10-07T15:00:00.000Z",
  "updatedAt": "2026-10-07T15:00:10.000Z"
}
```

Registry files and directories use user-only permissions where the operating system supports POSIX
permission bits.

## Send request

```json
{
  "protocol": 1,
  "token": "target bearer token",
  "id": "message UUID",
  "kind": "message",
  "replyRequested": true,
  "replyToMessageId": null,
  "from": {
    "sessionId": "sender session ID",
    "alias": "frontend",
    "cwd": "/workspace/frontend"
  },
  "to": "receiver session ID",
  "message": "The API contract changed.",
  "delivery": "prompt",
  "sentAt": "2026-10-07T15:01:00.000Z"
}
```

`delivery` is either:

- `prompt`: notify the timeline and queue the text into the receiving agent;
- `notify`: notify the timeline and persist the message without starting agent work.

Messages are limited to 32 KiB after UTF-8 encoding.

`kind` is either `message` or `reply`. Prompt messages request a reply by default. A reply must
contain `replyToMessageId`, uses `replyRequested: false`, and therefore cannot produce a reply loop.

## Success response

```json
{
  "ok": true,
  "messageId": "message UUID",
  "receivedAt": "2026-10-07T15:01:00.050Z"
}
```

## Failure response

```json
{
  "ok": false,
  "error": "Authentication failed."
}
```

Failures are explicit. The sender does not receive a success-shaped fallback when the target cannot
authenticate, validate or persist a message.

The success response acknowledges persistence and acceptance, not completion of agent work. A
requested agent response arrives asynchronously as another message:

```json
{
  "kind": "reply",
  "replyRequested": false,
  "replyToMessageId": "original message UUID",
  "delivery": "notify",
  "message": "The receiving agent's final response."
}
```

## Compatibility

Receivers reject unsupported protocol versions. A future incompatible protocol must use a new
versioned state directory and explicit migration or dual-protocol support.
