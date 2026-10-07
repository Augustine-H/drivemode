# Cloud → NAS → PC deployment

Routing code and deployment manifests are ready. Remote servers are not provisioned by these files alone.

## Verified installation — 2026-10-07 (KST)

The Synology DS218+ TTS project is installed and running. Its private Tailscale HTTPS endpoint and the PC endpoint both pass authenticated health checks with their correct identities, 100000-character caps and cluster mode. Current private web-server routing is NAS → PC; cloud is intentionally absent because the user requested configuration preparation only, without creating paid infrastructure.

Real Leda PCM synthesis succeeded on NAS and PC. On 2026-10-07, stopping only NAS TTS selected PC automatically; the user heard a new answer on S26 Ultra using mobile data. Restoring NAS TTS restored NAS priority. Routing tests cover the full cloud → NAS → PC chain, but actual cloud recovery remains unverified until a cloud host is deployed.

Desktop and mobile render checks passed for development and built output. The user confirmed phone audio on mobile data and voice interruption. The web relay runs on NAS port 8097, reached through private Tailscale HTTPS port 8445. TTS fallback requires this web relay to remain available; a complete NAS outage also interrupts the NAS-hosted app URL. The PC fallback requires the PC powered on and its user logged in; its corrected automatic startup passed an actual reboot test.

## Topology

The web application's authenticated server proxy checks cloud, NAS, then PC on each request. An authenticated `/health` read has a 2-second deadline per candidate. Only a backend with working Google authentication, matching node identity and the assigned character limit is selected. The first healthy backend receives the request. The next request returns to cloud after recovery.

Once a synthesis or settings POST has been submitted, it is never replayed on another server, even if the connection fails before response headers. Audio streams are forwarded as they arrive; interruption stops the current segment. The next segment/request can select another server. This prevents automatic duplicate billing but cannot guarantee that manually resubmitting the same segment to a different independent server is deduplicated.

Cloud, NAS and PC all call Google Cloud TTS. They are alternate backend hosts, not alternate offline speech engines. An internet or Google-wide outage may affect all three.

## Monthly allocations

Use one Google billing project and three persistent, distinct ledgers:

| Node | GOOGLE_TTS_NODE_ID | GOOGLE_TTS_MONTHLY_THRESHOLD |
|---|---|---|
| Cloud | cloud | 800000 |
| NAS | nas | 100000 |
| PC | pc | 100000 |

Set `GOOGLE_TTS_CLUSTER_MODE=true` on all three services. This disables paid overage at the service itself, including previously saved overage settings. The proxy also checks the actual backend cap before submitting anything. Caps sum to 1,000,000, and a node switches to WaveNet when its own allocation runs out. Unused allocations are not transferred. Warnings and counts displayed in the UI are for the selected node, not a live combined tally. This is a conservative application estimate; other uses of the Google project are outside these ledgers, and WaveNet may also have charges.

Never delete, roll back, clone across live nodes or replace a node's ledger to reset usage. Keep the allocations and node identities fixed for a billing month. Changing allocations mid-month needs an audit of already consumed usage. Increasing the total guard beyond 1,000,000 requires an explicit code/configuration change.

## Web server configuration

Set the server-only `GOOGLE_TTS_BACKENDS` value as JSON in the deployment's private environment configuration:

```json
[
  {"id":"cloud","url":"https://CLOUD_TTS_HOST","token":"PRIVATE_CLOUD_TOKEN_48_OR_MORE_CHARACTERS_REQUIRED","budget":800000},
  {"id":"nas","url":"https://imhmh.synology.me:NAS_TTS_HTTPS_PORT","token":"PRIVATE_NAS_TOKEN_48_OR_MORE_CHARACTERS_REQUIRED","budget":100000},
  {"id":"pc","url":"https://PC_TTS_HOST","token":"PRIVATE_PC_TOKEN_48_OR_MORE_CHARACTERS_REQUIRED","budget":100000}
]
```

These are placeholders. Keep the existing separate `GOOGLE_TTS_ACCESS_TOKEN` for browser authorization. Tokens, Google credentials and backend addresses are never client environment variables. Partial lists are allowed for staged rollout, but order must remain cloud → NAS → PC. The existing single-backend configuration remains supported when this JSON is absent.

All URLs must be root origins and remote endpoints must use HTTPS. Remote addresses must be reachable from the web server, which can differ from the phone's network. On a cloud-hosted web server, `127.0.0.1` refers to that server and cannot reach the user's PC. Private VPN-only addresses require that the proxy host joins that network.

## Synology DS218+

Use the secret-free backend package with `compose.nas.yaml` in Synology's Docker/Container Manager. It exposes port 8092 on NAS loopback only and owns a named persistent volume. Supply `private/adc.json` and `private/backend-token` separately, with a distinct 48+ character NAS token. Restrict the private folder's DSM ACL to its administrator and Container Manager before uploading credentials. The init container copies these files into the persistent volume, sets the runtime files to UID 1000/mode 0600, and restricts the source folder to root/mode 0700. Never copy PC ADC into the package or expose it over the web. This session's PC ADC copy was explicitly authorized by the user; separate workload identity is preferable for later production operation.

The supplied `https://imhmh.synology.me:5119` is the DSM administrator interface; it is not the TTS endpoint. Keep it and existing music/storage services intact. Both NAS and PC already have Tailscale, so the prepared one-time `enable-private-https.sh` adds a separate NAS Serve port 8444 without replacing music port 8443. The intended NAS TTS origin is `https://ds218-hmh.tail15dbbb.ts.net:8444`; PC TTS uses `https://ryzen5600x-hmh.tail15dbbb.ts.net:8444`. These are private tailnet endpoints, accessible only from connected devices. A future cloud web proxy must also join this private network; Vercel functions cannot reach these private origins without a separate gateway arrangement. Register the NAS endpoint only after an authenticated TTS health check succeeds.

PC local startup can load server-only routing and cap settings from `%LOCALAPPDATA%/VoiceGrok/Tts/backend-config.json`, outside the repository. This file is private and contains backend tokens. A production cloud deployment receives equivalent server-only environment values.

NAS deployment requires an authenticated DSM administrator session or SSH access. Knowing its public URL alone does not grant installation access.

## Google Cloud

The local gcloud session can access an existing project `project-dfe49229-8bbd-45db-ac4` (My First Project). Billing is enabled and Text-to-Speech API is enabled. Compute Engine API is not yet enabled. No paid VM has been created for this deployment.

Proposed host: a single Compute Engine `e2-small` VM in Seoul (`asia-northeast3`), persistent boot disk, Docker Compose using `compose.cloud.yaml`, and a dedicated HTTPS reverse proxy. VM, disk, public networking and TTS usage may incur charges; the VM should stay running for automatic failover. Do not use ephemeral container storage for the ledger or multiple replicas of the same node.

Attach a dedicated service account allowed to call Text-to-Speech and use the cloud-platform OAuth scope. Google's SDK obtains ADC from the attached identity; do not create/download a service-account JSON key for the cloud host. Supply the backend token through private runtime configuration, never source-control or startup-script metadata. Configure DNS and a valid TLS certificate for the selected cloud origin; expose HTTPS only and restrict administrative access.

Google reference: https://cloud.google.com/docs/authentication/set-up-adc-attached-service-account

## PC

Preserve the private ledger and use a 100000-character cap with cluster mode. Make PC reachable through authenticated HTTPS/VPN from the web proxy host. On this PC, Tailscale HTTPS and a console-free Windows logon supervisor are installed; the active operational data directory and launcher runtime are documented in [README.md](README.md). The corrected actual PC reboot/logon test passed on 2026-10-07 with HTTPS authentication and usage/configuration preserved. The PC must be powered on and the hosting user logged in; the logon trigger does not provide pre-login hosting.

## Acceptance checks

1. Each server's authenticated `/health` reports its identity, authentication=true, API=true, assigned threshold and allowOverage=false; unauthenticated reads return 401.
2. Configure cloud only first, then add NAS and PC after each has passed real Leda streaming and persistent-ledger restart checks.
3. Disconnect cloud and observe NAS; disconnect cloud and NAS and observe PC. Restore cloud and verify the next request selects cloud.
4. Interrupt a submitted stream and confirm it is not replayed on another server; cancel playback and verify the upstream stream is closed.
5. Use S26 Ultra to verify real microphone barge-in and network changes. This cannot be established from desktop checks alone.

Local routing tests simulate these failures without sending conversation text to Google or spending TTS quota. NAS image installation, real synthesis and restart persistence have been verified as recorded above; cloud installation and S26 hardware behavior remain pending.
