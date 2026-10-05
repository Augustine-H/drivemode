$ErrorActionPreference = 'Stop'
$musicRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$musicPython = Join-Path $musicRoot '.music-runtime/venv/Scripts/pythonw.exe'
$musicLauncher = Join-Path $PSScriptRoot 'autostart.py'
$musicTaskName = 'VoiceGrok Music - Logon'
$musicUser = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($musicFile in @($musicPython, $musicLauncher,
    (Join-Path $env:LOCALAPPDATA 'VoiceGrok/Music/worker-api.dpapi'),
    (Join-Path $env:LOCALAPPDATA 'VoiceGrok/Music/nas-bridge.dpapi'))) {
    if (-not (Test-Path -LiteralPath $musicFile -PathType Leaf)) {
        throw "Missing music startup prerequisite: $musicFile"
    }
}
$musicArguments = '"' + $musicLauncher + '"'
& (Join-Path $musicRoot '.music-runtime/venv/Scripts/python.exe') $musicLauncher --configure
if ($LASTEXITCODE -ne 0) { throw 'Music credential path resolution failed.' }
$musicExisting = Get-ScheduledTask -TaskName $musicTaskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($musicExisting) {
    if ($musicExisting.Actions.Count -ne 1 -or
        $musicExisting.Actions[0].Execute -ne $musicPython -or
        $musicExisting.Actions[0].Arguments -ne $musicArguments -or
        $musicExisting.Description -ne 'VoiceGrok Music: start existing user-bound Worker and NAS bridge at logon.') {
        throw 'An unrelated or changed task has this name; refusing to overwrite it.'
    }
}
$musicAction = New-ScheduledTaskAction -Execute $musicPython -Argument $musicArguments -WorkingDirectory $musicRoot
$musicTrigger = New-ScheduledTaskTrigger -AtLogOn -User $musicUser
$musicTrigger.Delay = 'PT15S'
$musicPrincipal = New-ScheduledTaskPrincipal -UserId $musicUser -LogonType Interactive -RunLevel Limited
$musicSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$musicTask = New-ScheduledTask -Action $musicAction -Trigger $musicTrigger -Principal $musicPrincipal `
    -Settings $musicSettings -Description 'VoiceGrok Music: start existing user-bound Worker and NAS bridge at logon.'
Register-ScheduledTask -TaskName $musicTaskName -TaskPath '\' -InputObject $musicTask -Force | Out-Null
$musicEvidence = Join-Path $musicRoot '.music-runtime/autostart'
New-Item -ItemType Directory -Path $musicEvidence -Force | Out-Null
Export-ScheduledTask -TaskName $musicTaskName -TaskPath '\' | Set-Content -LiteralPath (Join-Path $musicEvidence 'task.xml') -Encoding Unicode
Get-ScheduledTask -TaskName $musicTaskName -TaskPath '\' | Select-Object TaskName, State
