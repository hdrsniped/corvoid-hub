# Launch Corvoid Hub in dev mode (live reload). Close the terminal or press Ctrl-C to quit.
$env:CARGO_BUILD_JOBS = '2'
Set-Location $PSScriptRoot
# Use corvoid-hub.json from this folder when present (git-ignored, your own paths).
if (Test-Path "$PSScriptRoot\corvoid-hub.json") { $env:CORVOID_HUB_CONFIG = "$PSScriptRoot\corvoid-hub.json" }
$Host.UI.RawUI.WindowTitle = 'Corvoid Hub (dev)'
bun run tauri dev
