param(
    [string]$Uv = "uv",
    [string]$Python = "3.12"
)
$ErrorActionPreference = "Stop"
$musicRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$musicRuntime = Join-Path $musicRoot ".music-runtime"
$musicPython = Join-Path $musicRuntime "venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $musicPython)) {
    & $Uv venv (Join-Path $musicRuntime "venv") --python $Python
    if ($LASTEXITCODE -ne 0) { throw "Unable to create the isolated music environment." }
}
# Official stable-audio-3 source pins torch/torchaudio 2.7.1; use its documented CUDA 12.6 build.
& $Uv pip install --python $musicPython torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu126
if ($LASTEXITCODE -ne 0) { throw "CUDA PyTorch installation failed." }
& $Uv pip install --python $musicPython -r (Join-Path $PSScriptRoot "requirements-win-cu126.lock")
if ($LASTEXITCODE -ne 0) { throw "Music dependencies installation failed." }
& $Uv pip freeze --python $musicPython | Set-Content -Encoding utf8 (Join-Path $musicRuntime "installed-requirements.txt")
& $musicPython (Join-Path $PSScriptRoot "preflight.py") --output (Join-Path $musicRuntime "preflight.json")
if ($LASTEXITCODE -eq 2) {
    Write-Host "Environment checked. Model access or GPU setup still needs attention; see preflight.json."
} elseif ($LASTEXITCODE -ne 0) {
    throw "Music preflight failed."
}
