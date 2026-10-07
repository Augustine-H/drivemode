# Voice Grok encrypted recovery

Keep encrypted `.vgrec` archives on the backup disk and the portable 64-hex-character AES key on a different physical disk. Neither belongs in Git, source packages or app settings. NAS and PC archives are separate and use AES-256-GCM with independent random IVs and authenticated format metadata.

## Current installation

- NAS web listens on loopback 8097; Tailscale Serve HTTPS 8445 targets that port. Jellyfin remains on 8096.
- NAS and PC TTS listen on loopback 8092, exposed privately through their respective Tailscale HTTPS 8444 endpoints. Music HTTPS 8443 remains separate.
- NAS web Compose uses MagicDNS 100.100.100.100 and restart unless-stopped. Root boot recovery runs `tailscale configure-host`, then restarts pkgctl-Tailscale.service.
- Active PC TTS data is `I:/VoiceGrok-Private/Tts`, restricted to its Windows user and SYSTEM. The enabled `VoiceGrok TTS - Logon` task uses the existing GUI Python runtime to launch the supervisor without a console. Paths are installation-specific; reinstall the task after restoring on a different PC.
- Current routing is NAS → PC. Paid cloud operation has not been enabled.

## Refresh and check

NAS: run `create-recovery-backup.sh` through the existing disabled root recovery task after placing the existing recovery key in its private recovery folder. It captures online SQLite, ADC/tokens, private web configuration, current deployment configuration, Serve mappings and NAS machine identity. It removes temporary plaintext files and the temporary NAS key after success. Download only the encrypted archive and checksum.

PC: run `node services/tts/backup-pc.mjs DATA_DIRECTORY RECOVERY_KEY OUTPUT_DIRECTORY` using an access-restricted output folder. It captures the complete online SQLite ledger, existing ADC/token/configuration, installed supervisor and GUI launcher, scheduled task XML and Serve mappings. It authenticates the saved archive and checks the SQLite snapshot, then removes the temporary database. It does not store Windows or Tailscale machine identity; reauthenticate Tailscale when replacing the PC.

Verify either archive with `node services/web/nas/verify-recovery-memory.mjs ARCHIVE RECOVERY_KEY PRIVATE_DIRECTORY`. Credentials are decrypted only in memory; SQLite alone is briefly written in the existing private directory for integrity checking and then removed. A current NAS archive must contain web port 8097. Verify external copy hashes too.

## Restore during a planned outage

Retain a pre-restore backup. Authenticate the archive before extracting it into an isolated restricted directory using a trusted AES-GCM implementation with AAD `VoiceGrokRecovery-v1`. NAS archive payload is gzip tar containing `web/`, `tts/`, `network/` and a manifest. PC payload contains `pc/` and a manifest. The older NAS-only `verify-recovery.mjs` extracts NAS payloads and checks their credentials/database; it leaves plaintext that must be removed after restoration.

Restore complete ledgers rather than starting empty quota databases. Keep token, ADC and matching web routing configuration together. NAS deployments need the updated Compose, start script and HTTPS setup pointing at 8097. Restore TTS private files through the initialization job and named volume. Keep the root boot recovery task enabled. New devices should reauthenticate Tailscale and restore Serve mappings; never run two devices with the same restored NAS identity.

On PC, restore `pc/` operational files outside the repository, apply restricted ACLs, provide Node and GUI Python runtimes, then reinstall `install-pc-autostart.ps1` with explicit project, runtime and data paths. Verify authenticated local and private HTTPS health, quota/voice settings, persisted usage and task state after login. Remove plaintext restoration files when finished.

## Latest verified backups — 2026-10-07

NAS archive voice-grok-recovery-20261007T144137Z.vgrec includes current Production Google Workspace encrypted tokens, current web/TTS configuration, NAS identity and Serve mappings. PC archive voice-grok-pc-recovery-20261007T144032Z.vgrec includes online TTS database and the installed logon supervisor/task configuration. Both archives are verified with authenticated AES-GCM decryption and SQLite integrity checks. NAS web port 8097 and Google connection recovery data are present.

Encrypted archives/checksums and current google6 NAS deployment/public-source packages are retained on the access-restricted PC recovery folder and the separate H: backup disk. The portable recovery key remains on the separate K: disk; no plaintext credentials were extracted during verification. Successful NAS backup removed its temporarily supplied key. Archives and recovery keys are excluded from Git and public source packages.

The owner confirmed natural Calendar date/weekday/time, mail sender/title and long-body summary playback on S26. Latest-deployment NAS reboot recovery is being checked separately; archive verification alone is not a reboot or production-restore test.
