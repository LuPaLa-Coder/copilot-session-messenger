# Changelog

All notable changes are documented in this file.

## [Unreleased]

## [0.2.2] - 2026-10-12

### Changed

- `session_messenger_list` instructs the agent to always show sessions as a table (alias, working folder, start time).

## [0.2.1] - 2026-10-12

### Changed

- Default alias is now the working folder name plus the first 2 characters of the session ID.

### Fixed

- Unix socket path too long on macOS: the default socket directory now lives under `/tmp`.

## [0.2.0] - 2026-10-07

### Added

- Automatic relay of the receiving agent's final response to the originating session.
- Message/reply correlation through `kind` and `replyToMessageId`.
- Configurable `expectReply` behavior for prompt deliveries.

### Changed

- Initial sends are acknowledged after persistence while agent processing continues asynchronously.
- Automatic replies use notification delivery and cannot request another reply.
- Development installation uses only the user-scoped extension to avoid duplicate tool collisions.
- Default aliases are now short (`ses-` plus the first 4 characters of the session ID).

## [0.1.0] - 2026-10-07

### Added

- Local discovery of active Copilot CLI sessions.
- Persistent aliases and inboxes.
- Authenticated Unix-socket and Windows named-pipe delivery.
- `prompt` and `notify` delivery modes.
- Heartbeats and stale-session cleanup.
- Copilot plugin and marketplace manifests.
- Dependency-free Node.js test suite and cross-platform CI.
- Architecture, protocol, security, troubleshooting and remote-relay documentation.
