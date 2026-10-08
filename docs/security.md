# Security model

## Trust boundary

Version `0.1.0` is designed for sessions owned by the same local operating-system user. It is not a
multi-user chat system and does not provide an authorization model among different human users.

The principal security goals are:

- prevent unrelated local users from discovering or writing messages;
- prevent unauthenticated writes to a session endpoint;
- prevent messages from silently escalating Copilot permissions;
- avoid transferring sensitive session context.

## Controls

### Private state

Registry, aliases and inboxes are stored below the current user's Copilot home. On Unix-like
systems, directories are forced to mode `0700` and files to `0600`. Symbolic-link state
directories are rejected.

### Per-session authentication

Each peer creates a random 256-bit bearer token. The token is placed in the private registry and
compared with a constant-time comparison by the receiving endpoint.

This proves that the sender can access the current user's private registry. It does not distinguish
between different processes running as that same operating-system user.

### Bounded inputs

- messages: 32 KiB;
- wire frames: 64 KiB;
- inbox: rotates after 1 MiB and retains the latest 200 entries;
- inbox reads: at most 100 entries.

Malformed JSON, unsupported versions, invalid delivery modes, incorrect destinations and ambiguous
targets fail explicitly.

### Prompt-injection boundary

An incoming `prompt` message is prefixed and suffixed with provenance information and an explicit
statement that it is untrusted peer input. It cannot grant permissions or replace system and user
instructions.

This reduces accidental instruction confusion but does not make arbitrary peer content safe. Users
should use `notify` when a message is informational and does not need autonomous agent handling.

Automatic replies relay only the final textual assistant response. They use notification delivery
and explicitly disable further reply requests, so two sessions cannot enter an automatic
request-response loop.

## Data not transferred

The plugin sends only the text supplied to `session_messenger_send` plus sender metadata:

- session ID;
- alias;
- working directory;
- timestamp.

It does not send transcripts, files, secrets, environment variables, memory, tool permissions or
model credentials.

## Known limitations

- Any process running as the same OS user can read the registry and impersonate a peer.
- Inbox data is plaintext on the local filesystem.
- Sender aliases are convenience labels, not cryptographic identities.
- Local delivery is not end-to-end encrypted because it remains within the same user account and
  host.
- Malware already running as the current user is outside this threat model.

Cross-device delivery must not reuse this bearer-token registry design. See
[Remote relay roadmap](remote-relay.md) for the stronger model required.

## Reporting vulnerabilities

Do not disclose a vulnerability in a public issue before a fix is available. Use the repository's
private vulnerability reporting or GitHub Security Advisory feature when enabled.
