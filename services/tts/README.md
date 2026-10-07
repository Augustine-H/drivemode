# Voice Grok Google TTS

Cloud → NAS → PC automatic routing and deployment manifests: [DEPLOYMENT.md](DEPLOYMENT.md).

Google TTS runs in a dedicated Node 22.13+ / Node 24 backend. This service is
independent of the Vercel web function and owns a persistent SQLite usage ledger.
Mount its data directory on persistent storage in production. Never place Google
ADC files, backend tokens, or this ledger in public assets or an APK.

## Configuration

- `GOOGLE_TTS_DATA_DIR`: persistent private directory; defaults to the local user
  profile's `VoiceGrok/Tts` directory.
- `GOOGLE_TTS_VOICE`: defaults to `ko-KR-Chirp3-HD-Leda`.
- `GOOGLE_TTS_MONTHLY_THRESHOLD`: defaults to 1,000,000 Unicode characters.
  This is an application guard, not a guarantee of free Google service.
- `GOOGLE_TTS_BACKEND_TOKEN`: service bearer token (48+ characters). If absent,
  the local service generates a token in its private data directory.
- `GOOGLE_TTS_HOST` / `GOOGLE_TTS_PORT`: defaults to loopback / 8092.

ADC is automatically discovered by Google's SDK. In production use workload
identity or the runtime's service identity; no service-account JSON generation is
required. A voice-list request verifies auth/API at startup and on connection
checks. Logs contain metadata only, never conversation text, tokens or ADC data.

The web server must have `GOOGLE_TTS_BACKEND_URL`, `GOOGLE_TTS_BACKEND_TOKEN`,
and a separate `GOOGLE_TTS_ACCESS_TOKEN`. Only authenticated bearer requests may
use the production proxy. The access code is entered in advanced TTS settings
and kept for the browser session. Development permits same-origin loopback
requests and reads the local backend token on the server; these exceptions are
disabled in production. Remote backend connections require HTTPS. An Android
client uses the authenticated backend; Google credentials stay server-side.

## Behavior and verification

The existing LLM sentence/phrase stream feeds the provider without waiting for the full
answer. Each segment has a playback/response/sequence identity. PCM at 24 kHz is
scheduled immediately in Web Audio. Cancellation aborts HTTP/gRPC, retry timers,
and all queued audio sources. A partial audio failure never resynthesizes the
already spoken segment. Before-audio failures use stream reconnect with 1/2/4s
backoff, standard Chirp, then an API-discovered Korean WaveNet voice. Offline
errors stop retries.

Every actual attempt reserves its Unicode character count before submission,
so concurrent calls and retries cannot exceed the guard unnoticed. Definitive
rejections release the reservation; network ambiguity and interrupted requests
remain conservative estimates. Confirmed audio attempts have first-audio and
completion timestamps. Browser diagnostics measure request-to-first-playback
latency. Monthly periods use Asia/Seoul. Warning state and usage survive restart.
The entire next segment falls back before it would cross the guard.

`node --test scripts/google-tts.test.mjs` covers thresholds, month rollover,
persistence, duplicate requests, auth, overage consent, fallback and disconnect.
Local startup: `scripts/startup.ps1`; Linux web startup remains `startup.sh`.
Production requires deploying this persistent backend separately and configuring
the web server's three variables above. An APK/AudioTrack implementation is not
present in this repository; phone hardware verification is a separate check.

Official reference: https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd

## Windows logon supervision — verified 2026-10-07

`install-pc-autostart.ps1` registers `VoiceGrok TTS - Logon` for the current Windows user, with an interactive logon trigger, limited privileges, no password storage, no execution time limit and three supervisor restart attempts at one-minute intervals. The hidden supervisor polls authenticated local health every 15 seconds. It restarts an exited backend and stops only its own child after three consecutive unresponsive checks. Google/network authentication errors with a responding backend do not trigger a restart. Existing listeners are not duplicated or killed.

On this PC, the scheduled-task session could not see the previous Codex-local `%LOCALAPPDATA%/VoiceGrok/Tts` directory. Active operational data is now `I:/VoiceGrok-Private/Tts`, outside this repository, restricted to the user and SYSTEM. Existing token, cluster configuration, complete stopped SQLite ledger/WAL state and Google ADC were retained. `google-adc.json` is supplied explicitly to the backend. The older local directory is retained but no longer used by the managed service. Keep the operational directory private and include it in a separately encrypted PC recovery backup; never add it to deployment ZIPs or Git. The installer accepts `-DataDirectory` for this location. Project and Node runtime paths must remain available.

Verification: task Running; forced termination of managed PID 29540 recovered as PID 23672; Tailscale HTTPS authentication/API passed; usage and configuration exactly matched the pre-change baseline. No actual Windows reboot/logoff test was performed. The PC must be powered on and this user logged in. `scripts/startup.ps1` delegates to the scheduled supervisor when installed, preventing a second backend against the stale ledger. Logs and installed supervisor are under the operational directory's `Autostart` subfolder. To pause deliberately, disable/stop the supervisor task before stopping its backend.

References: [Windows task settings](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset), [interactive task principal](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal).

### Actual PC reboot follow-up — 2026-10-07

Console fix at 14:08 KST: the original `Start-Process -WindowStyle Hidden` Tailscale tray launch created a visible Windows Terminal log window. Replaced it with a direct `ProcessStartInfo` launch using `UseShellExecute=false` and `CreateNoWindow=true`, then replaced the existing tray process through the scheduled supervisor. Tailscale remained connected with one tray process and the supervisor Running; its authenticated HTTPS endpoint was reachable and returned the expected 401 for an unauthenticated probe. No TTS data or access policy changed.

PC boot time was 12:57:28 KST. After user sign-in around 13:05, the scheduled supervisor started at 13:05:51 and launched TTS at 13:05:55 without manual TTS startup. Local authentication/API passed, with the original 185 Chirp characters, zero WaveNet characters and unchanged quota/voice configuration. However, the initial five-minute HTTPS verification failed because the Tailscale tray client was absent; Windows user-mode Tailscale disconnected when CLI clients exited. A service restart did not resolve that missing client.

Updated the supervisor to launch the existing official `tailscale-ipn.exe` in the current user session when absent. This retains the existing account and session access duration; unattended/pre-login mode was not enabled. Reinstalled/restarted the supervisor; it launched the tray client at 13:11:02, Tailscale became Running/online with no health warnings, and the persisted 8444 Serve mapping and authenticated HTTPS recovered. Usage/configuration still matched the baseline. TTS actual logon startup passed; the corrected combined Tailscale/TTS startup has passed manual scheduled-task execution but still needs another actual reboot test. Evidence: `artifacts/pc-tts-reboot-after-repair.json`; the original failed automated result is retained separately in `pc-tts-reboot-result.json`. Both one-time reboot/verification tasks are disabled; the normal logon supervisor remains Running and enabled.

### Corrected PC reboot retest — passed 2026-10-07

Before the second reboot, the supervisor's exit code indicated a console termination signal (0xC000013A). The scheduled task itself now runs through the existing GUI Python runtime (`.music-runtime/venv/Scripts/pythonw.exe`) and `launch-pc-supervisor.py`, which launches PowerShell using `CREATE_NO_WINDOW`. The Tailscale child also uses `CreateNoWindow`; both layers avoid console attachment. Keep this Python runtime, the project, Node runtime and private operational directory available. The verification task uses the same console-free launcher.

The actual new boot time was 14:14:53 KST. The logon task ran at 14:15:10, the supervisor started at 14:15:23, Tailscale tray client at 14:15:24, and TTS at 14:15:28. At 14:16:06, the automatic verification passed: new boot, Google authentication/API, local service, Tailscale HTTPS, running supervisor/tray client, exact usage preservation (185 Chirp characters, zero WaveNet) and all quota/voice settings. No manual service launch or repair was performed after this reboot. The verifier exited normally (0) and disabled itself. Both one-time reboot/verification tasks are disabled; normal logon supervision remains enabled and Running. A later status check showed Tailscale Running/online with no health warnings, one tray client and one TTS backend; the NAS app remained healthy on its corrected 8097 proxy target.

Current successful report: `artifacts/pc-tts-reboot-result.json`. Previous failed report and baseline were retained as `pc-tts-reboot-result-first-attempt.json` and `pc-tts-reboot-before-first-attempt.json`. Updated task definition: `artifacts/pc-tts-autostart-task.xml`. This verifies operation after user login; pre-login hosting and a new phone-side fallback test are outside this check.
