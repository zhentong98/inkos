# Deployment acceptance — 2026-09-25

Target: `https://write.liewchentong.com`

- Application source: `zhentong98/inkos`, commit
  `091048383f411eb99948a8764f42b6fd13006f9b`, version 1.8.0.
- Deployment configuration: branch `codex/private-server-deploy`; no upstream
  application code changed and no merge into master performed.
- Linux/amd64 production image: `inkos@sha256:dc8141455a0f2c92d0b32a2e9817012422edbf542c9e45cc136e046d4a9f2ee8`.
  The local Docker configuration ID was
  `sha256:97cee70b20d157b1d80cc91fa9ac3c1663733648a3fd766ac19c382299ec57bd`.
  Source labels and all eight RootFS layer hashes matched after transfer.

## Checks completed

1. Core, Studio frontend/server, and CLI builds passed. The five Access verifier
   tests passed locally, during build, and in the final amd64 image. A first build
   failed on a temporary-path-contaminated npm lockfile; the corrected build passed.
2. Fresh independent review found no code security blocker. Missing bootstrap
   ownership/network documentation was corrected. Runtime startup additionally
   caught an unquoted YAML tmpfs comma, corrected and verified via resolved Compose
   JSON before successful startup.
3. All three Inkos containers healthy, with no published host ports. App UID 1000,
   read-only root, separate persistent data and 1 CPU / 1 GiB limits.
4. Owner completed real Cloudflare Access email login. Browser rendered the English
   Studio home and Model Config page; zero providers connected. No model API keys,
   model requests, generation, or billable connectivity tests were used.
5. Anonymous public requests returned Cloudflare Access HTTP 302. Direct origin
   requests for `/`, `/api/v1/books`, `/api/v1/project`, and `/api/v1/services/config`
   returned 401. A forged Access assertion returned 401. Cloudflare Full (strict)
   remained enabled, and the new hostname certificate matched its private key.
6. Application restart preserved the exact SHA256 of `inkos.json`. Project
   language remained `en`; model and API key configuration were absent.
7. Initial encrypted local restic snapshot `bcb9ce21` passed `restic check` and a
   restore into a separate directory. Restored configuration matched the live
   configuration; backup password was excluded. App was running and unpaused.
   Daily timer enabled for 05:17 Asia/Kuala_Lumpur, retaining the latest 14 snapshots.
8. Existing 15 containers retained IDs, image IDs, status, start timestamps, and
   mounts. Shared gateway configuration was validated and gracefully reloaded.
   Staging and demo internal readiness returned 200. Public personal site and demo
   returned 200, while staging retained its expected Access redirect.

Idle observation: app ~48 MiB, verifier ~33 MiB, origin ~6 MiB. Server root filesystem
had ~78 GiB free (33% used), with ~2.3 GiB available RAM. These are idle observations,
not a concurrent-generation load test.

## Deliberate limits

Backups are encrypted on the same VPS; offsite disaster recovery is not configured.
The origin verifier is an additional small service because upstream Studio has no
login protection. Full novel generation, export of generated content, and provider
connectivity await the user's model configuration. No full upstream unit suite was
claimed; validation focused on unchanged application build and new deployment behavior.

## Follow-up repair — 2026-09-25 12:55 MYT

- Application/deployment revision `e6a7a005d6d86d1ffcfaf036aad8946943eafaf0`,
  pushed to the existing fork branch `codex/private-server-deploy`.
- Fixed successful `propose_action` cards incorrectly returning 502 when their
  quoted instructions mention an earlier failure. Explicit tool errors are retained.
- Regression reproduced before the fix (two expected-200 responses were 502).
  After the fix, all 162 server API tests and all 583 Studio tests in 59 files
  passed. Core TypeScript and Studio server builds passed. Independent read-only
  code and deployment-delta reviews reported no actionable findings. This is not
  a claim that the entire monorepo test suite was run.
- The amd64 image build, including the five Access verifier tests, passed.
  Server image: `inkos@sha256:8779f101ca9a270797a97eeb2e77fba69709228be0a16cb95d4481c4fcca1ba3`.
  All eight RootFS layers and the source-revision label matched the local image.
- Encrypted pre-update snapshot `813e49e8` saved. Previous Compose and image
  setting retained in `/etc/inkos/rollback-before-e6a7a005`; old image retained.
- Only `inkos-app-1` changed container identity. The dedicated origin was validated
  and gracefully reloaded; shared services were not restarted. New app healthy,
  zero restarts, no published ports; anonymous public access still returned 302.
- Model stream idle timeout is now a bounded 600000 ms. The earlier Claude setup
  request was cancelled at the former 180000 ms deadline; OpenRouter recorded
  6120 reasoning tokens and no final completion. Short probes with Responses and
  Chat protocols both returned OK. This does not establish that Cloudflare 524
  request timeouts are resolved. The new long-running creation remains a separate
  acceptance check.
- Generated DeepSeek chapters and configuration persisted. Chapter 2 remains
  blocked on state reconstruction; no successful six-chapter publication is claimed.
