# Troubleshooting

## No sessions are listed

Confirm that:

1. the plugin is installed for every Copilot CLI process;
2. each session was opened or restarted after installation;
3. the extension loaded successfully in `/env`;
4. both sessions run as the same operating-system user.

Run `scripts/install-local.sh` or `scripts/install-local.ps1` for user-scoped installation when
sessions in different repositories must communicate. Do not install a second project-scoped copy
with the same extension name because its globally unique tool names will collide.

## A target is ambiguous

Assign explicit aliases:

```text
Imposta l'alias di questa sessione a backend-orders.
```

Then target the exact alias. Session IDs and unique prefixes also work.

## A target disappears

Registry entries expire after 45 seconds without a heartbeat. This prevents dead sessions and
reused process IDs from remaining discoverable. Restart or resume the target Copilot session.

## Connection refused or endpoint not found

The target likely exited after discovery but before delivery. Run the session list tool again and
retry only after verifying that the target is active.

## Authentication failed

The registry entry may have changed while the target restarted. Refresh the session list and send
again. Persistent failures can indicate damaged state below:

```text
~/.copilot/session-messenger/v1/
```

Stop all Copilot sessions before manually removing only that directory.

## Messages appear in the inbox but the agent does not respond

Check the delivery mode. `notify` intentionally avoids invoking the receiving agent. Use `prompt`
when the receiver should act.

If `prompt` processing fails, inspect the extension log through Copilot CLI's extension management
UI. When possible, the receiver sends the processing failure back as the correlated reply.

## The send is acknowledged but no reply arrives

The initial acknowledgement only confirms that the target persisted the message. The agent response
is asynchronous and can take longer.

Verify that:

- the message used `prompt` delivery;
- `expectReply` was not set to `false`;
- the source session is still active when the response is ready;
- the receiving extension log does not report a model timeout or reply-delivery failure.

Automatic replies use `notify`, appear as `Reply from ...`, and include `replyToMessageId` in the
inbox record.

## Extension fails to load

Check for:

- a Copilot CLI version without extension support;
- another extension registering one of the same globally unique tool names;
- both user-scoped and project-scoped copies of Session Messenger being loaded;
- syntax errors reported by `npm run check`;
- permission errors on the Copilot home or system temporary directory.

Run locally:

```bash
npm run validate
```
