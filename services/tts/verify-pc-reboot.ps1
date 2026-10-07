param(
  [Parameter(Mandatory=$true)][string]$ProjectRoot,
  [Parameter(Mandatory=$true)][string]$DataDirectory
)
$ErrorActionPreference='Stop'
$taskReportPath=Join-Path $ProjectRoot 'artifacts/pc-tts-reboot-result.json'
$taskBefore=Get-Content (Join-Path $ProjectRoot 'artifacts/pc-tts-reboot-before.json') -Raw|ConvertFrom-Json
$taskBoot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$taskReport=[ordered]@{At=(Get-Date).ToString('o');BootTime=$taskBoot.ToString('o');NewBoot=($taskBoot.ToUniversalTime() -gt [DateTime]::Parse($taskBefore.BootTime).ToUniversalTime());Passed=$false;Authentication=$false;Api=$false;UsagePreserved=$false;ConfigPreserved=$false;TaskRunning=$false;HttpsReady=$false;TrayClientRunning=$false}
try {
  if(-not $taskReport.NewBoot){throw 'New boot required'}
  $taskDeadline=(Get-Date).AddMinutes(5)
  while((Get-Date) -lt $taskDeadline){
    try {
      $taskToken=(Get-Content (Join-Path $DataDirectory 'backend-token') -Raw).Trim()
      $taskStatus=Invoke-RestMethod 'http://127.0.0.1:8092/health' -Headers @{Authorization=('Bearer '+$taskToken)} -TimeoutSec 5
      $taskReport.Authentication=[bool]$taskStatus.authentication
      $taskReport.Api=[bool]$taskStatus.api
      $taskReport.TaskRunning=(Get-ScheduledTask -TaskName 'VoiceGrok TTS - Logon').State -eq 'Running'
      $taskReport.UsagePreserved=($taskStatus.usage.googleChirpCharacters -eq $taskBefore.Usage.googleChirpCharacters -and $taskStatus.usage.googleWaveNetCharacters -eq $taskBefore.Usage.googleWaveNetCharacters)
      $taskReport.ConfigPreserved=($taskStatus.config.threshold -eq $taskBefore.Config.threshold -and $taskStatus.config.cluster -eq $taskBefore.Config.cluster -and $taskStatus.config.allowOverage -eq $taskBefore.Config.allowOverage -and $taskStatus.config.voice -eq $taskBefore.Config.voice -and $taskStatus.config.streaming -eq $taskBefore.Config.streaming -and $taskStatus.config.fallbackVoice -eq $taskBefore.Config.fallbackVoice)
      $taskReport.TrayClientRunning=[bool](Get-Process -Name 'tailscale-ipn' -ErrorAction SilentlyContinue)
      $taskRemote=Invoke-RestMethod 'https://ryzen5600x-hmh.tail15dbbb.ts.net:8444/status' -Headers @{Authorization=('Bearer '+$taskToken)} -TimeoutSec 15
      $taskReport.HttpsReady=$taskRemote.authentication -and $taskRemote.api
      if($taskReport.Authentication -and $taskReport.Api -and $taskReport.TaskRunning -and $taskReport.HttpsReady -and $taskReport.TrayClientRunning){
        $taskReport.Passed=$taskReport.UsagePreserved -and $taskReport.ConfigPreserved
        break
      }
    } catch { }
    Start-Sleep -Seconds 10
  }
} catch { $taskReport.Failure='Post-reboot verification could not complete' }
$taskReport.At=(Get-Date).ToString('o')
$taskReport|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $taskReportPath -Encoding UTF8
Disable-ScheduledTask -TaskName 'VoiceGrok TTS - Reboot Verification'|Out-Null
if(-not $taskReport.Passed){exit 1}
