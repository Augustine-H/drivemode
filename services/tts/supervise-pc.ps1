param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'VoiceGrok/Tts')
)
$ErrorActionPreference = 'Stop'
$taskData = $DataDirectory
$taskLogs = Join-Path $taskData 'Autostart'
$taskChild = $null
$taskFailures = 0
$taskMutex = New-Object Threading.Mutex($false, 'Local\VoiceGrok-Tts-Supervisor')
try { $taskLocked = $taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $taskLocked = $true }
if (-not $taskLocked) { $taskMutex.Dispose(); exit 0 }
function Write-Event([string]$Message) {
  Add-Content -LiteralPath (Join-Path $taskLogs 'supervisor.log') -Value ((Get-Date).ToString('o') + ' ' + $Message)
}
try {
  $null = New-Item -ItemType Directory -Path $taskLogs -Force
  Write-Event 'Supervisor started'
  while ($true) {
    try {
      # Windows user-mode Tailscale disconnects when its tray client exits.
      # Start the existing official client in this logon session; keep the
      # existing account and user-session access duration unchanged.
      $taskTailClient = Join-Path $env:ProgramFiles 'Tailscale\tailscale-ipn.exe'
      if ((Test-Path -LiteralPath $taskTailClient) -and -not (Get-Process -Name 'tailscale-ipn' -ErrorAction SilentlyContinue)) {
        # WindowStyle alone can still create a Windows Terminal log window.
        # Launch directly with CREATE_NO_WINDOW, without shell association.
        $taskTailStart = New-Object System.Diagnostics.ProcessStartInfo
        $taskTailStart.FileName = $taskTailClient
        $taskTailStart.UseShellExecute = $false
        $taskTailStart.CreateNoWindow = $true
        $taskTailStart.WorkingDirectory = Split-Path $taskTailClient -Parent
        $taskTailProcess = [System.Diagnostics.Process]::Start($taskTailStart)
        $taskTailProcess.Dispose()
        Write-Event 'Existing Tailscale tray client started without a console'
      }
      # Never silently initialize a replacement token or empty usage ledger.
      foreach ($taskFile in @('backend-config.json', 'backend-token', 'usage.sqlite')) {
        if (-not (Test-Path -LiteralPath (Join-Path $taskData $taskFile))) { throw 'Required persistent configuration missing' }
      }
      $taskConfig = Get-Content -LiteralPath (Join-Path $taskData 'backend-config.json') -Raw | ConvertFrom-Json
      if (-not $taskConfig.pcCluster -or [int]$taskConfig.pcThreshold -lt 1) { throw 'Invalid cluster cap configuration' }
      $taskToken = (Get-Content -LiteralPath (Join-Path $taskData 'backend-token') -Raw).Trim()
      $taskHealthy = $false
      try {
        $taskHealth = Invoke-RestMethod 'http://127.0.0.1:8092/health' -Headers @{Authorization=('Bearer ' + $taskToken)} -TimeoutSec 3
        $taskHealthy = $taskHealth.nodeId -eq 'pc'
      } catch { }
      if ($taskHealthy) { $taskFailures = 0 }
      else {
        if ($taskChild -and -not $taskChild.HasExited) {
          $taskFailures++
          if ($taskFailures -ge 3) {
            # Only terminate this supervisor's own unresponsive child.
            Stop-Process -Id $taskChild.Id -Force
            $taskChild.WaitForExit()
            Write-Event 'Unresponsive owned backend stopped'
          }
        }
        if ((-not $taskChild -or $taskChild.HasExited) -and -not (Get-NetTCPConnection -State Listen -LocalPort 8092 -ErrorAction SilentlyContinue)) {
          if (-not (Test-Path -LiteralPath $NodePath) -or -not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'services/tts/server.mjs'))) { throw 'Backend runtime unavailable' }
          $env:GOOGLE_TTS_DATA_DIR = $taskData
          if (Test-Path -LiteralPath (Join-Path $taskData 'google-adc.json')) { $env:GOOGLE_APPLICATION_CREDENTIALS = Join-Path $taskData 'google-adc.json' }
          $env:GOOGLE_TTS_CLUSTER_MODE = 'true'
          $env:GOOGLE_TTS_MONTHLY_THRESHOLD = [string]$taskConfig.pcThreshold
          $env:GOOGLE_TTS_NODE_ID = 'pc'
          $env:GOOGLE_TTS_HOST = '127.0.0.1'
          $env:GOOGLE_TTS_PORT = '8092'
          Remove-Item Env:GOOGLE_TTS_BACKEND_TOKEN -ErrorAction SilentlyContinue
          $taskChild = Start-Process -FilePath $NodePath -ArgumentList 'services/tts/server.mjs' -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogs 'backend.log') -RedirectStandardError (Join-Path $taskLogs 'backend-error.log') -PassThru
          $taskFailures = 0
          Write-Event ('Backend started pid=' + $taskChild.Id)
        }
      }
    } catch {
      # Do not log exception text: configuration and credentials are private.
      Write-Event 'Recovery deferred; check configuration, runtime and private backend logs'
    }
    Start-Sleep -Seconds 15
  }
} finally {
  if ($taskLocked) { $taskMutex.ReleaseMutex() }
  $taskMutex.Dispose()
}
