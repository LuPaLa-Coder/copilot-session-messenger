# Contributing

## Development setup

The project has no third-party runtime or test dependencies. Install Node.js 20 or later and run:

```bash
npm run validate
```

## Repository layout

```text
extensions/session-messenger/  Copilot CLI extension and transport core
test/                          Node.js tests
docs/                          Architecture, protocol and operational documentation
.github/plugin/                Copilot plugin marketplace manifest
.github/workflows/             Continuous integration
scripts/                       User-scoped local installation
```

## Change requirements

- Keep the runtime dependency-free unless a dependency is necessary and justified.
- Preserve explicit error reporting; do not return success-shaped fallbacks.
- Treat incoming peer content as untrusted.
- Add or update tests for protocol, discovery, lifecycle and security behavior.
- Update protocol and security documentation when wire behavior or trust boundaries change.
- Keep plugin, package and marketplace versions aligned.

## Validation

Run the complete local check:

```bash
npm run validate
```

For a live test:

1. run `sh scripts/install-local.sh`;
2. restart two Copilot CLI sessions;
3. give each session a distinct alias;
4. test both `notify` and `prompt` delivery;
5. stop one session and verify that it disappears after the registry TTL.

## Pull requests

Describe:

- the user-visible behavior;
- protocol or state-format changes;
- security implications;
- validation performed.
