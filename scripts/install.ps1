#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$ReleaseBase = $env:AGENT_TODO_RELEASE_BASE_URL
if (-not $ReleaseBase) {
  $ReleaseBase = "https://github.com/DaltonVector-ai/agent-todo/releases/latest/download"
}

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$os = "windows"
$binName = "agent-todo-$os-$arch.exe"
$url = "$ReleaseBase/$binName"

$installDir = $env:AGENT_TODO_INSTALL_DIR
if (-not $installDir) {
  $installDir = Join-Path $env:USERPROFILE ".local\bin"
}
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$dest = Join-Path $installDir "agent-todo.exe"

Write-Host "Downloading $url -> $dest"
Invoke-WebRequest -Uri $url -OutFile $dest

Write-Host "Add $installDir to PATH, then run: agent-todo install"
