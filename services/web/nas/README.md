# Voice Grok on Synology DS218+

This deployment moves the web application and Google TTS proxy onto NAS. Cloud infrastructure is not created. The existing TTS and music projects remain separate.

## Build and package

Build with `VOICE_GROK_DEPLOY_TARGET=nas` and `npm run build`. The default build still uses Vercel. Copy the complete `.output` contents into `app/` beside the supplied Dockerfile, start.mjs and compose.yaml. Package those public deployment files only; never include private runtime configuration or Google credentials. Nitro's standalone Node build requires no npm installation on NAS.

## Private runtime configuration

Create `private/runtime.json` outside the archive with these server-only properties:

```json
{
  "login": "EXACT_TAILSCALE_OWNER_LOGIN",
  "origin": "https://NAS_TAILNET_HOST:8445",
  "backends": [
    {"id":"nas","url":"http://127.0.0.1:8092","token":"PRIVATE_NAS_TOKEN","budget":100000},
    {"id":"pc","url":"https://PC_TAILNET_HOST:8444","token":"PRIVATE_PC_TOKEN","budget":100000}
  ]
}
```

Restrict the private directory's DSM ACL to owner/administrators/Container Manager before upload. The init container copies configuration into a private named volume, then restricts its files to mode 0600. Google ADC remains with the existing NAS TTS service and is not mounted into the web application. Tokens must be at least 48 characters.

An optional `xaiApiKey` property in this private configuration supplies `XAI_API_KEY` to the server process for conversation and transcription. Omit it when unavailable. Never add the key to browser settings, source, image layers, logs, or deployment ZIPs. Updating configuration requires running config-init again and restarting web; restarting only web retains the previous volume configuration. The updated start.mjs must be included in the rebuilt image.

The web container uses the host network only to reach the existing NAS loopback TTS endpoint and PC's Tailscale endpoint. Its entrypoint forcibly binds the HTTP listener to **127.0.0.1:8097**, never all interfaces. Keep this restriction. Compose explicitly sets `VOICE_GROK_WEB_PORT=8097`, including when using an older image with the previous default. There is no Docker-published web port. All application routes require the exact owner's Tailscale identity headers and HTTPS forwarded origin. This identity mode is explicitly opt-in and does not alter the default deployment's access-code authentication.

Port migration reported by the user on 2026-10-07: Jellyfin retains 8096; Voice Grok Web was moved to 8097 because host networking shares the NAS port namespace. The source entrypoint, Compose and private HTTPS setup now consistently use 8097. The setup script permits migration of the known old 8445 proxy target (127.0.0.1:8096) to 127.0.0.1:8097, while rejecting an unrelated target. The public private-tailnet app URL remains on HTTPS 8445. Older encrypted recovery archives and deployment packages may contain 8096: use these updated files during restore. The live internal listener change is user-reported; application reachability alone does not establish which internal port is listening.

Live follow-up at approximately 13:50 KST: the HTTPS 8445 URL initially returned Jellyfin and its TTS route returned 404. DSM Text Editor showed the NAS setup script already targeted 8097 but rejected any existing target other than 8097, blocking migration from the old 8096 target. Saved the corrected known-target migration guard to the actual NAS script and ran the existing disabled-by-default root `VoiceGrok TTS Private HTTPS Setup` task, whose existing commands configure TTS then web HTTPS. The app then returned Voice Grok, `/api/google-tts` returned HTTP 200 with authenticated NAS routing and the preserved 189-character ledger, and a short speech request returned 11 PCM frames plus done. The successfully executed web setup command targets loopback 8097. Jellyfin configuration and the external app port 8445 were not changed. Evidence: `artifacts/nas-port-8097-speech.json`, `artifacts/nas-port-8097-verification.json`, and `screenshots/nas-port-8097-restored.png`. No additional NAS reboot was performed after this port migration.

Set the web service's Compose `dns` to `100.100.100.100` (Tailscale MagicDNS). Public DNS servers cannot resolve the private PC tailnet name. After changing Compose, recreate the web container; a container restart or `docker compose start` retains its old DNS settings. On this NAS, Container Manager's editor changes did not update the deployed `compose.yaml`; verify the actual file before building/recreating the project.

The one-time enable-private-https.sh adds a separate Tailscale Serve endpoint on 8445 after checking that the port is unoccupied or already targets this app. It preserves music 8443 and TTS 8444. Do not enable Funnel or expose the loopback listener with another proxy that passes client-supplied identity headers. Tailscale Serve removes forged incoming identity headers and supplies its own; users of tagged devices lack these user headers and are deliberately rejected.

Reference: [Nitro Node server](https://nitro.build/deploy/runtimes/node), [Tailscale Serve identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers).

## Verification and phone use

Use the NAS HTTPS app URL from a device connected to the same Tailscale owner account. In Settings → Voice/playback, the TTS section should show NAS and allow the Leda sample. No browser TTS access code is needed on this private NAS origin. Authentication to Google and backend tokens remain on the servers.

Verify real PCM delivery, NAS proxy operation while the PC services are stopped, restart persistence, desktop/mobile rendering, missing/wrong identity rejection, and cross-origin POST rejection. Restore PC services after isolation checks. A stopped NAS web application cannot itself route to PC: the NAS web host must be running, even when it selects the PC TTS fallback.

On S26 Ultra, verify speaker playback and playback interruption by speaking, then repeat a fresh request after switching Wi-Fi/mobile data with Tailscale enabled. A desktop mobile viewport is not hardware verification. The NAS origin has separate browser storage; conversations and settings from another app origin do not transfer automatically.

The approved xAI credential is configured only in the private NAS runtime volume. This package contains no API key. NAS Grok conversation streaming and an app-generated voice message were verified. The user confirmed actual S26 microphone input, spoken reply and voice interruption. NAS hosting avoids a new cloud server bill; existing Google/xAI usage charges and NAS operating costs are separate.

## Current status

2026-10-07 KST: Node and default Vercel builds, typecheck, routing/identity tests, and desktop/mobile renders pass. Secret-free files are installed at `/volume1/docker/voice-grok-web`. Private configuration and the owner-only HTTPS app are active at https://ds218-hmh.tail15dbbb.ts.net:8445. Live desktop/mobile renders pass without console errors. With PC Voice Grok ports 8080/8081/8092 stopped, the NAS app generated Leda PCM (13 audio frames) and rejected a duplicate segment with HTTP 409; PC app/TTS services were restored. NAS is selected first, with PC TTS fallback. S26 Ultra playback was confirmed by the user on both Wi-Fi and mobile data. The private xAI credential is active in image voice-grok-web:1.30.0-xai1; NAS chat returned HTTP 200 with a complete streamed response, and the app produced a playable voice message. Post-update desktop/mobile renders have no console errors. The user confirmed actual S26 microphone input, spoken reply and voice interruption.

## Recovery readiness audit — 2026-10-07 KST

The user subsequently confirmed S26 microphone input, spoken Grok response and voice interruption. This audit did not reboot NAS, stop containers, restart Tailscale, change settings, or generate paid speech/chat requests.

| Item | Evidence and limit |
| --- | --- |
| Web and TTS automatic restart | Both live DSM container detail screens show automatic restart enabled. Compose uses `unless-stopped`; a manually stopped service must be started again before relying on boot recovery. |
| Current availability | NAS app HTTP 200, selected backend `nas`; authenticated NAS and PC TTS health both HTTP 200, authentication/API true, threshold 100000, overage false. These checks from PC do not prove NAS outbound access to PC. |
| Runtime persistence | Web private runtime uses named `web-config`; TTS authentication and `usage.sqlite` use named `tts-data`. Initializers are intentionally one-shot and stopped after success; existing runtime volumes are needed for boot recovery. Configuration structure and previous successful deployment support this, but no new disk-loss restore test was performed. |
| Private HTTPS persistence | Both setup scripts use Tailscale Serve `--bg`, which persists across restart. The disabled one-time HTTPS setup scheduler task need not run on every boot. A currently serving URL does not prove recovery after a real reboot. |
| NAS outbound Tailscale boot configuration | The complete DSM scheduler list has 11 tasks and no Tailscale configure-host/configure-synology boot task. On DSM7, official Tailscale guidance requires a root Boot-up task to restore outbound TUN access. NAS-to-PC TTS fallback after reboot remains unverified. Do not add or run that task during this read-only audit. |
| Tailscale device credential expiry | PC Tailscale peer status reports NAS online and KeyExpiry 2027-04-03 01:38:08 UTC (10:38:08 KST). Plan renewal before this date; expiry policy was not changed. |
| Disaster recovery backup | Deployment ZIPs are available and deliberately exclude credentials. A verified encrypted backup of the NAS private configuration/runtime volumes and usage ledger has not been established in this audit. Existing Hyper Backup tasks were not audited for inclusion of these volumes. |

Recovery needs the web/TTS deployment files or retained images, NAS private web runtime.json (owner login, backend tokens, xAI key), Google ADC and NAS backend token, both named volumes, and the Tailscale machine identity/Serve settings. Store credential-bearing backups encrypted outside deployment archives. Preserve the TTS usage ledger and deduplication records rather than creating an empty database; resetting it can invalidate monthly quota protection. Use a consistent SQLite backup/snapshot of usage.sqlite (including any active WAL state); do not copy only a live database file blindly. No secret backup was created in this audit.

Recommended next work: register and verify the Tailscale outbound Boot-up task, plan device-auth renewal, then create and test an encrypted recovery backup. A real NAS reboot test remains deferred.

Follow-up on 2026-10-07 KST: DSM now contains the enabled `VoiceGrok Tailscale Boot Recovery` task, trigger `Boot-up`, owner `root`. Its saved script was reopened and verified to contain `set -eu`, `/var/packages/Tailscale/target/bin/tailscale configure-host`, then `synosystemctl restart pkgctl-Tailscale.service`. The password dialog is no longer present because the task has been saved. No immediate task run, Tailscale service restart or NAS reboot was performed in this registration check; execution at boot remains untested. Device-auth expiry and encrypted-backup follow-ups remain outstanding.

References: [Docker restart policy](https://docs.docker.com/engine/containers/start-containers-automatically/), [Tailscale Serve persistence](https://tailscale.com/docs/reference/tailscale-cli/serve), [Synology outbound boot configuration](https://tailscale.com/docs/integrations/synology#enable-outbound-connections).

## Encrypted recovery backup — 2026-10-07 KST

An on-demand, disabled-by-default DSM root task named `VoiceGrok Encrypted Recovery Backup` runs `sh /volume1/docker/voice-grok-web/create-recovery-backup.sh`. It is not a recurring schedule. Re-running requires securely supplying the recovery key again; successful runs remove the temporary NAS key. Services stay running.

Completed archive: `voice-grok-recovery-20261006T163242Z.vgrec` (created 2026-10-07 01:32:42 KST), AES-256-GCM with authenticated format metadata and a random 256-bit recovery key. NAS retains the archive/checksum under `/volume1/docker/voice-grok-web/private/recovery`. PC retains a separate copy under `%LOCALAPPDATA%/VoiceGrok/Recovery`; that directory's ACL is restricted to the current Windows user and SYSTEM. `recovery-key.txt` is stored separately from the archive and is never in deployment ZIPs or logs. Keep an additional offline copy of this key and archive on separate storage before relying on recovery from PC disk loss.

Contents: the live web runtime configuration including approved xAI/backend credentials, Google ADC and NAS TTS token, a consistent SQLite online backup of usage/deduplication records, web/TTS Compose and startup/HTTPS scripts, Tailscale Serve configuration and machine state. Application source/build assets remain in the existing secret-free deployment ZIPs; combine those packages with this encrypted archive for recovery. Browser-local conversations/settings are outside this server backup.

Verification passed on an isolated PC restore: AES-GCM authentication/decryption; exact NAS/PC SHA-256 match `ecd82ba4ef6ae497a2cabc80026f981d0e2ed870785ab29636965538acd53fbb`; credential consistency; SQLite integrity_check `ok`; 11 request records and 11 deduplication records; 2026-10 Chirp usage 163 characters; valid Tailscale machine-state JSON and HTTPS 8445 mapping. Live NAS app/TTS remain healthy. No production restore or real NAS reboot was performed.

The first attempt left a zero-byte `.vgrec.partial` file after an encryption-input newline error; this is not a usable backup. The corrected retry completed successfully. NAS plaintext staging and temporary database snapshots were cleaned by the task. Permanent deletion of the isolated PC plaintext verification directory was blocked by automatic approval review; it was moved to the current user's Recycle Bin using a recoverable filesystem operation. Final disposal of that specific Recycle Bin item remains outstanding; do not empty unrelated user files.

Recovery procedure: verify the encrypted archive hash; decrypt using the separately retained key into an access-restricted isolated folder with `verify-recovery.mjs`; verify DB/credentials/configuration before restoring. On a replacement NAS, restore the deployment packages, then populate the private web configuration and TTS data volume with the recovered credentials and complete usage.sqlite. Start the initialization jobs and services with the original node identity/caps; do not replace the restored usage database with an empty ledger. Tailscale state belongs to this machine: do not run an original and replacement machine simultaneously with the same identity. Prefer reauthentication on a new device, then update private origins/login and Serve mappings as needed. A production restore should happen only during a planned outage with a retained pre-restore backup.

Reference: [Node SQLite online backup](https://nodejs.org/download/release/v24.8.0/docs/api/sqlite.html#sqlitebackupsourceDb-path-options).

## External storage copies — 2026-10-07 KST

Plaintext disposal follow-up: the user permanently deleted the isolated `restore-check-20261007` Recycle Bin item. Read-only checks confirm zero matching Recycle Bin entries, absence of its known recycled data directory and absence of the original verification directory. The encrypted PC/H: archive copies and PC/K: recovery-key copies still match. The temporary plaintext disposal item is complete.

Completed on separate USB physical disks: H: (`WD140EDFZ_WDBWLG0140HBK`, disk 7) stores the encrypted archive/checksum, both web/TTS deployment ZIPs, verification reports and Korean recovery instructions under `H:/VoiceGrok-Recovery/2026-10-07`. K: (`WD80EFAX`, disk 5) stores the recovery key separately under `K:/VoiceGrok-Recovery-Key/2026-10-07`. These are different drives from the PC system disk and each other. Both new folders have inheritance disabled and access restricted to the current Windows user and SYSTEM.

All six copied source files match their source SHA-256 values (key hash is not disclosed), and the external H: archive successfully authenticated/decrypted in memory using the K: key. No plaintext restoration folder was created for this check. New-PC administrators may need to reassign NTFS ownership/access; the key itself is portable and not bound to Windows DPAPI. Drive letters can change, so identify the saved folder names and volume labels. Keep the disks separately and use safe removal before physically unplugging them. No disk eject or NAS reboot was performed.

## Tailscale key expiry follow-up — 2026-10-07 KST

After explicit user approval, disabled device key expiry for NAS `ds218-hmh` only in the Tailscale admin console. Reloaded machine details show `Expiry disabled` and Connected. The previous NAS expiry of 2027-04-03 10:38:08 KST no longer applies. PC and phone expiry settings were not changed. This prevents scheduled NAS node credential expiry from interrupting unattended hosting; it does not prevent outages caused by device removal, account/policy changes or loss of network connectivity. No NAS reboot or service restart was needed.

Reference: [Tailscale unattended operation](https://tailscale.com/docs/how-to/run-unattended).

## Actual reboot check — 2026-10-07 KST

With explicit user authorization, initiated a real DSM restart around 03:39 KST. Before restart, NAS app returned HTTP 200 and TTS authentication was true; usage was 163 Chirp characters for 2026-10, threshold 100000, overage false and cluster true. Baseline saved in `artifacts/nas-reboot-before.json` (no credentials). App became unavailable at approximately 03:39:53; Tailscale peer became offline. DSM returned its initialization screen, then the sign-in screen by 03:47 KST. At 03:47:24, NAS Tailscale was still offline and app unavailable. Automatic recovery has not passed. DSM session ended during reboot; administrator sign-in is required to inspect boot-task results and package/container status. No manual service start or second reboot has been performed. Post-reboot data persistence, speech and NAS-to-PC fallback checks remain pending.

Follow-up at 11:24–11:37 KST: Tailscale and the NAS app were online before manual intervention. DSM showed web and TTS containers had automatically started at 03:56 and 03:57; the root Boot-up task ran at 03:46:42–03:46:54 and exited normally (0). Before speech tests, NAS usage still exactly matched 163 Chirp characters and all quota settings matched the pre-reboot baseline. Initial recovery therefore took about 18 minutes; the early 03:47 observation was incomplete.

The PC TTS process was off when testing fallback, so it was started with its existing cluster/100000-character configuration. PC health passed, but NAS fallback still failed with ENOTFOUND: the web container had only 8.8.8.8/8.8.4.4 DNS. A direct MagicDNS query from that container resolved the PC correctly, showing outbound Tailscale connectivity was available. Manually rerunning the existing boot recovery task did not fix this DNS configuration. Updated the actual NAS compose.yaml and the source package to specify MagicDNS, then Container Manager build explicitly recreated web. Following that change, with NAS TTS stopped, the live NAS app selected PC and delivered HTTP 200 with 9 PCM audio frames plus done. Restored NAS TTS; priority returned to NAS and its live speech test also produced 9 PCM frames plus done. App reload rendered normally. Evidence is under artifacts/nas-reboot-*.json. No second full NAS reboot after the DNS correction or new S26 hardware test has been performed. The encrypted archive predates this correction; restore using the updated deployment Compose rather than overwriting it with the old archived Compose.

## Reboot after DNS correction — 2026-10-07 KST, passed

With explicit user authorization, restarted DSM again around 11:52 KST after the MagicDNS correction. PC TTS was started and its existing authentication/API configuration verified before this test. No NAS service, container or recovery task was started manually after the reboot. The app automatically returned at 12:07:37 KST (about 15 minutes) and selected PC while NAS TTS was still unavailable. A live speech request succeeded with HTTP 200, 12 PCM audio frames and done. This confirms that the corrected DNS supports NAS-to-PC connectivity after a full reboot.

At 12:09:12 KST (about 17 minutes), routing automatically returned to NAS; two consecutive authenticated NAS observations passed. Before any NAS speech request, the NAS usage ledger still exactly matched 176 Chirp characters and zero WaveNet characters, and all quota/voice settings matched the pre-reboot baseline. NAS speech then succeeded with HTTP 200, 11 PCM audio frames and done; its usage increased normally to 189 characters. The app rendered successfully in the browser. Evidence is in `artifacts/nas-dns-reboot-*.json`, the observation JSONL and `screenshots/nas-dns-reboot-app.png`.

The automatic boot sequence itself provided the unavailable-NAS/working-PC fallback test, so no additional container stop or DSM administrator sign-in was needed. PC fallback still requires an awake PC with its TTS process running; this test does not establish PC startup persistence. No new S26 speaker/microphone test was performed. Keep the updated deployment Compose when restoring the older encrypted recovery archive.

## S26 fallback after PC autostart and 8097 migration — passed 2026-10-07

After the user prepared S26 with Tailscale and mobile data, stopped only NAS `voice-grok-tts-tts-1` around 14:26 KST. The web app stayed running. Its live routing reported NAS unavailable and PC connected with authentication true. During the test, PC Chirp usage increased from 185 to 219 characters for a new speech request; no synthetic PC speech request was sent by the operator in this test window. The user explicitly confirmed hearing the new answer on S26, rather than replaying a cached voice message. Restored NAS TTS at 14:30 KST and confirmed the live app again selected authenticated NAS. Both the fallback and restoration passed. Evidence: `artifacts/mobile-fallback-*.json`, `screenshots/mobile-fallback-nas-stopped.png`, and `screenshots/mobile-fallback-nas-restored.png`. This verifies TTS service failure fallback while the NAS web relay remains available; complete NAS/web unavailability still makes this NAS-hosted app URL unavailable.

## Reboot after 8097 migration — passed 2026-10-07

Restarted DSM around 14:34 KST with the corrected 8097 web target. No service/container or boot recovery task was started manually. The root Tailscale Boot Recovery task ran automatically at 14:41:02–14:41:13 and exited normally (0). The web application returned at 14:50:27 and automatically selected authenticated PC TTS. At 14:51:58 it returned to authenticated NAS TTS; a second NAS observation at 14:52:29 passed. Recovery took approximately 17 minutes. Before synthesis, the NAS ledger exactly matched 305 Chirp characters and zero WaveNet, with all quota and voice settings preserved. A subsequent short synthesis returned HTTP 200, ten audio frames and done, increasing usage to 317 characters. Browser rendering and console checks passed. Evidence is retained locally in `artifacts/nas-8097-reboot-*.json` and screenshots; diagnostic artifacts are excluded from source uploads.

## Updated encrypted backup — completed 2026-10-07

The disabled one-time recovery task ran at 14:52:59–14:53:14 and exited normally (0). Latest NAS archive: `voice-grok-recovery-20261007T055304Z.vgrec`, SHA-256 `c89f5b1daaf772bfd4d08149913f17e225caa059f07e989d46492698e11836a5`. It includes current NAS credentials/configuration, SQLite online snapshot with 317 Chirp characters, MagicDNS Compose, the 8097 default in start.mjs, 8097 private HTTPS setup and persisted Serve mapping, and the boot recovery script. Existing NAS Compose omits an explicit port variable and uses the start script's 8097 default; the public deployment Compose additionally specifies 8097 explicitly. The verifier checks both valid configurations and the actual HTTPS target.

Downloaded archive/checksum and private PC/external H: copies match. In-memory authenticated decryption, credential consistency and SQLite integrity passed without extracting plaintext credentials. Temporary NAS recovery key is absent from the recovery folder after completion. The PC backup described in `services/tts/RECOVERY.md` separately captures its current operational data and automatic startup configuration. Archives and recovery keys are excluded from Git and deployment ZIPs.
