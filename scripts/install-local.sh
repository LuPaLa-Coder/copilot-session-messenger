#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
copilot_home=${COPILOT_HOME:-"$HOME/.copilot"}
target="$copilot_home/extensions/session-messenger"

mkdir -p "$target"
cp "$repo_dir/extensions/session-messenger/extension.mjs" "$target/extension.mjs"
cp "$repo_dir/extensions/session-messenger/messenger-core.mjs" "$target/messenger-core.mjs"

printf "Installed Session Messenger in %s\n" "$target"
printf "Restart Copilot CLI to load the extension.\n"
