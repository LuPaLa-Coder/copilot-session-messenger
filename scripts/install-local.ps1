$ErrorActionPreference = "Stop"

$RepoDirectory = Split-Path -Parent $PSScriptRoot
$CopilotHome = if ($env:COPILOT_HOME) {
    $env:COPILOT_HOME
} else {
    Join-Path $HOME ".copilot"
}
$Target = Join-Path $CopilotHome "extensions/session-messenger"
$Source = Join-Path $RepoDirectory "extensions/session-messenger"

New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item (Join-Path $Source "extension.mjs") (Join-Path $Target "extension.mjs") -Force
Copy-Item (Join-Path $Source "messenger-core.mjs") (Join-Path $Target "messenger-core.mjs") -Force

Write-Host "Installed Session Messenger in $Target"
Write-Host "Restart Copilot CLI to load the extension."
