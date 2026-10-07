$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $taskRoot
$taskNode = (Get-Command node).Source
$taskNpm = Get-ChildItem -LiteralPath "$env:LOCALAPPDATA/pnpm" -Filter npm-cli.js -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $taskNpm) { throw 'npm runtime not found' }
$taskRuntime = "$env:LOCALAPPDATA/VoiceGrok/Runtime"
$null = New-Item -ItemType Directory -Path $taskRuntime -Force
Set-Content -LiteralPath "$taskRuntime/npm.cmd" -Value "@echo off`r`n`"$taskNode`" `"$($taskNpm.FullName)`" %*" -Encoding ascii
$env:PATH = "$taskRuntime;" + $env:PATH
$taskTtsDirectory = $env:GOOGLE_TTS_DATA_DIR
if (-not $taskTtsDirectory) { $taskTtsDirectory = "$env:LOCALAPPDATA/VoiceGrok/Tts" }
$taskTtsConfigPath = Join-Path $taskTtsDirectory 'backend-config.json'
if (Test-Path -LiteralPath $taskTtsConfigPath) {
  $taskTtsConfig = Get-Content -LiteralPath $taskTtsConfigPath -Raw | ConvertFrom-Json
  if ($taskTtsConfig.backends) { $env:GOOGLE_TTS_BACKENDS = ConvertTo-Json -InputObject @($taskTtsConfig.backends) -Compress -Depth 5 }
  if ($taskTtsConfig.pcCluster) { $env:GOOGLE_TTS_CLUSTER_MODE = 'true'; $env:GOOGLE_TTS_MONTHLY_THRESHOLD = [string]$taskTtsConfig.pcThreshold }
}
try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/' -TimeoutSec 2; $taskHealthy = $true } catch { $taskHealthy = $false }
$taskTtsAutostart = Get-ScheduledTask -TaskName 'VoiceGrok TTS - Logon' -ErrorAction SilentlyContinue
if ($taskTtsAutostart) {
  if ($taskTtsAutostart.State -ne 'Running') { Start-ScheduledTask -TaskName 'VoiceGrok TTS - Logon' }
} elseif (-not (Get-NetTCPConnection -State Listen -LocalPort 8092 -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $taskNode -ArgumentList 'services/tts/server.mjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput "$taskRoot/.grok/tts.log" -RedirectStandardError "$taskRoot/.grok/tts-error.log"
}
if (-not $taskHealthy) {
  Start-Process -FilePath $taskNode -ArgumentList "`"$($taskNpm.FullName)`" run dev" -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput "$taskRoot/.grok/dev.log" -RedirectStandardError "$taskRoot/.grok/dev-error.log"
}
