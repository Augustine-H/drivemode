param([int]$Port = 8093)
$ErrorActionPreference = "Stop"
$musicRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$musicPython = Join-Path $musicRoot ".music-runtime/venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $musicPython)) { throw "Run the music setup first." }
# Run in this console so Ctrl+C drains the active job before stopping.
# The desktop agent may launch this script hidden; no task/service registration occurs.
& $musicPython (Join-Path $PSScriptRoot "worker_api.py") --port $Port
if ($LASTEXITCODE -ne 0) { throw "Music Worker exited with code $LASTEXITCODE" }
