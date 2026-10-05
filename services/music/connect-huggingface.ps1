param([switch]$ValidateOnly)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
Add-Type -AssemblyName System.Net.Http
[System.Windows.Forms.Application]::EnableVisualStyles()

$musicForm = [System.Windows.Forms.Form]::new()
$musicForm.Text = "Voice Grok · Hugging Face 연결"
$musicForm.ClientSize = [System.Drawing.Size]::new(580, 325)
$musicForm.StartPosition = "CenterScreen"
$musicForm.FormBorderStyle = "FixedDialog"
$musicForm.MaximizeBox = $false
$musicForm.Font = [System.Drawing.Font]::new("Malgun Gothic", 10)

$musicIntro = [System.Windows.Forms.Label]::new()
$musicIntro.Text = "모델 다운로드용 읽기 토큰을 연결합니다.`n약관에 동의한 Hugging Face 계정에서 토큰을 만들어 주세요."
$musicIntro.Location = [System.Drawing.Point]::new(22, 20)
$musicIntro.Size = [System.Drawing.Size]::new(535, 52)
$musicForm.Controls.Add($musicIntro)

$musicLink = [System.Windows.Forms.LinkLabel]::new()
$musicLink.Text = "Hugging Face 토큰 설정 열기"
$musicLink.Location = [System.Drawing.Point]::new(22, 78)
$musicLink.Size = [System.Drawing.Size]::new(530, 28)
$musicLink.Add_LinkClicked({ Start-Process 'https://huggingface.co/settings/tokens' })
$musicForm.Controls.Add($musicLink)

$musicHelp = [System.Windows.Forms.Label]::new()
$musicHelp.Text = "New token → Read 권한 → 이름 VoiceGrok → 생성 후 아래에 붙여넣기"
$musicHelp.Location = [System.Drawing.Point]::new(22, 109)
$musicHelp.Size = [System.Drawing.Size]::new(535, 28)
$musicForm.Controls.Add($musicHelp)

$musicTokenBox = [System.Windows.Forms.TextBox]::new()
$musicTokenBox.Location = [System.Drawing.Point]::new(22, 145)
$musicTokenBox.Size = [System.Drawing.Size]::new(532, 30)
$musicTokenBox.UseSystemPasswordChar = $true
$musicTokenBox.MaxLength = 1024
$musicForm.Controls.Add($musicTokenBox)

$musicStatus = [System.Windows.Forms.Label]::new()
$musicStatus.Text = "토큰은 공식 Hugging Face에만 전송하며, 이 PC에 암호화해 저장합니다."
$musicStatus.Location = [System.Drawing.Point]::new(22, 188)
$musicStatus.Size = [System.Drawing.Size]::new(535, 58)
$musicForm.Controls.Add($musicStatus)

$musicConnect = [System.Windows.Forms.Button]::new()
$musicConnect.Text = "연결 확인 및 저장"
$musicConnect.Location = [System.Drawing.Point]::new(360, 265)
$musicConnect.Size = [System.Drawing.Size]::new(195, 38)
$musicForm.AcceptButton = $musicConnect
$musicForm.Controls.Add($musicConnect)

$musicClose = [System.Windows.Forms.Button]::new()
$musicClose.Text = "닫기"
$musicClose.Location = [System.Drawing.Point]::new(245, 265)
$musicClose.Size = [System.Drawing.Size]::new(100, 38)
$musicClose.Add_Click({ $musicForm.Close() })
$musicForm.CancelButton = $musicClose
$musicForm.Controls.Add($musicClose)

$musicConnect.Add_Click({
    $musicToken = $musicTokenBox.Text.Trim()
    if ($musicToken -notmatch '^hf_[A-Za-z0-9]+$') {
        $musicStatus.Text = "hf_로 시작하는 토큰을 입력해 주세요."
        return
    }
    $musicConnect.Enabled = $false
    $musicStatus.Text = "모델 다운로드 권한을 확인하고 있습니다…"
    $musicForm.Refresh()
    $musicHttpHandler = [System.Net.Http.HttpClientHandler]::new()
    $musicHttpHandler.AllowAutoRedirect = $false
    $musicHttp = [System.Net.Http.HttpClient]::new($musicHttpHandler)
    $musicHttp.Timeout = [TimeSpan]::FromSeconds(20)
    $musicHttp.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $musicToken)
    try {
        $musicResponse = $musicHttp.GetAsync('https://huggingface.co/api/models/stabilityai/stable-audio-3-small-music/auth-check').GetAwaiter().GetResult()
        if (-not $musicResponse.IsSuccessStatusCode) {
            $musicStatus.Text = "권한 확인 실패 (HTTP $([int]$musicResponse.StatusCode)).`n계정·모델 약관 동의·Read 권한을 확인해 주세요."
            return
        }
        $musicSecretDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'VoiceGrok/Music'
        [IO.Directory]::CreateDirectory($musicSecretDir) | Out-Null
        $musicPlain = [Text.Encoding]::UTF8.GetBytes($musicToken)
        $musicEntropy = [Text.Encoding]::UTF8.GetBytes('VoiceGrok.Music.HuggingFace.v1')
        try {
            $musicProtected = [Security.Cryptography.ProtectedData]::Protect($musicPlain, $musicEntropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        } finally {
            [Array]::Clear($musicPlain, 0, $musicPlain.Length)
        }
        $musicSecretPath = Join-Path $musicSecretDir 'huggingface.dpapi'
        $musicTemporary = $musicSecretPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
        [IO.File]::WriteAllBytes($musicTemporary, $musicProtected)
        [IO.File]::Move($musicTemporary, $musicSecretPath, $true)
        $musicTokenBox.Clear()
        $musicTokenBox.Enabled = $false
        $musicStatus.Text = "연결 완료. 모델 다운로드 권한을 확인했고 암호화해 저장했습니다.`n창을 닫고 채팅에서 연결 완료라고 알려주세요."
        $musicConnect.Text = "연결 완료"
        $musicClose.Focus() | Out-Null
    } catch {
        # Never include an exception, request headers, or token in a log or dialog.
        $musicStatus.Text = "연결 또는 저장에 실패했습니다. 네트워크를 확인한 뒤 다시 눌러 주세요."
    } finally {
        if ($musicResponse) { $musicResponse.Dispose(); $musicResponse = $null }
        $musicHttp.Dispose()
        $musicHttpHandler.Dispose()
        $musicToken = $null
        if ($musicTokenBox.Enabled) { $musicConnect.Enabled = $true }
    }
})

if ($ValidateOnly) {
    $musicForm.Dispose()
    Write-Output "Credential dialog initialized; no credentials read or written."
    exit 0
}
$musicForm.Add_Shown({ $musicForm.Activate(); $musicTokenBox.Focus() | Out-Null })
[void]$musicForm.ShowDialog()
$musicTokenBox.Clear()
$musicForm.Dispose()
