param(
  [string]$ProjectRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
  [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'VoiceGrok/Tts'),
  [string]$PythonwPath = (Join-Path $ProjectRoot '.music-runtime\venv\Scripts\pythonw.exe')
)
$ErrorActionPreference = 'Stop'
$taskName = 'VoiceGrok TTS - Logon'
$taskData = $DataDirectory
$taskInstall = Join-Path $taskData 'Autostart'
foreach ($taskFile in @('backend-config.json', 'backend-token', 'usage.sqlite')) {
  if (-not (Test-Path -LiteralPath (Join-Path $taskData $taskFile))) { throw 'Existing PC TTS configuration is required' }
}
if (-not (Test-Path -LiteralPath $NodePath)) { throw 'Node runtime not found' }
if (-not (Test-Path -LiteralPath $PythonwPath)) { throw 'Existing GUI Python runtime required for a console-free task' }
$taskExisting = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($taskExisting -and $taskExisting.State -eq 'Running') { throw 'Stop the existing TTS supervisor before updating it' }
$null = New-Item -ItemType Directory -Path $taskInstall -Force
$taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $taskInstall /inheritance:r /grant:r "*${taskSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict supervisor directory permissions' }
$taskScript = Join-Path $taskInstall 'supervise-pc.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'supervise-pc.ps1') -Destination $taskScript -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch-pc-supervisor.py') -Destination (Join-Path $taskInstall 'launch-pc-supervisor.py') -Force
$taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskArgs = '"{0}" --script "{1}" --project-root "{2}" --node "{3}" --data "{4}"' -f (Join-Path $taskInstall 'launch-pc-supervisor.py'), $taskScript, $ProjectRoot, $NodePath, $taskData
$taskAction = New-ScheduledTaskAction -Execute $PythonwPath -Argument $taskArgs -WorkingDirectory $taskInstall
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Description 'Start existing private PC TTS at user logon; supervise process recovery without resetting credentials or usage.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'VoiceGrok TTS logon supervisor installed and started'
