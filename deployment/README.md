# Private Inkos server deployment

This deploys the user's `zhentong98/inkos` fork, initially based on
`091048383f411eb99948a8764f42b6fd13006f9b` (1.8.0). No upstream product code is changed.
The approved target is `https://write.liewchentong.com` on the existing shared VPS.

## Architecture and operational contract

Cloudflare Access permits only the existing owner identity. The shared SNI gateway
routes this hostname to a dedicated Nginx origin. Every application route requires
a signed Access JWT with the exact team issuer, application audience, and owner
email; reaching the origin IP does not bypass authentication. `/healthz` is available
only on the origin container's loopback HTTP listener.

The application and verifier have no published host ports. The origin joins
`inkos-ingress` (172.30.40.0/24), where the shared gateway has address 172.30.40.254.
Application traffic uses a separate `inkos-backend` network. Containers can reach
external model endpoints. The app runs as UID 1000 with a read-only root filesystem,
one CPU, a 1 GiB memory limit, and persistent `/srv/inkos/data` mounted at `/data`.
The server initializes an English project only when `inkos.json` does not exist.
Set the model and API key later through the protected settings page.

## Build and install

Build from this repository root with Docker Buildx for `linux/amd64`, using
`deployment/Dockerfile`. Transfer with `docker save`/`docker load`, then inspect
the image on the destination host and pin its repository digest in `/etc/inkos/.env`
as `INKOS_IMAGE=inkos@sha256:...`. Docker storage backends can report different
manifest and configuration IDs; compare source labels and RootFS layer hashes.
The Dockerfile pins Node 22 and pnpm 10, builds core, studio, and CLI, and executes
the verifier tests. Run standalone verifier tests with `npm ci && npm test` inside
`deployment/` using Node 22.

Copy `compose.yaml`, `nginx.conf`, and `backup.sh` into `/etc/inkos/`. Create a
root-owned mode-600 `access.env` containing `ACCESS_ISSUER`, `ACCESS_AUDIENCE`, and
`ACCESS_EMAIL`. Install the hostname's Cloudflare Origin CA certificate and matching
private key under `/etc/inkos/tls/{cert,key}.pem`. Keep Cloudflare proxying and strict
origin TLS enabled. Secrets, runtime data, and private keys must never enter Git.

Before startup on a fresh host, create the bind directory with the app's UID/GID
and the external ingress network (first check for overlapping existing subnets):

```sh
install -d -m 700 /etc/inkos /etc/inkos/tls
install -d -m 755 /srv/inkos
install -d -o 1000 -g 1000 -m 700 /srv/inkos/data
docker network inspect inkos-ingress >/dev/null 2>&1 || \
  docker network create --subnet 172.30.40.0/24 inkos-ingress
```

Attach the gateway to this network at 172.30.40.254 and declare that same external
network/address in its Compose file before routing requests to `inkos-origin`.
Start with `docker compose --project-directory /etc/inkos up -d`. Validate the Nginx
configuration before reloading the shared gateway. Back up both gateway files
before adding the new network, SNI mapping, and HTTP-to-HTTPS redirect. Verify all
previous domains remain healthy after gateway changes.

## Backups and rollback

`backup.sh` pauses only the Inkos app while making a bounded filesystem copy, then
immediately resumes it before encrypting that copy with restic. The copy includes
SQLite WAL files, books, settings, and separately captured server configuration.
The repository is `/srv/inkos/backups`; its password file is
`/etc/inkos/backup-password` (root-only and excluded from snapshots).
Initialize the repository before enabling `inkos-backup.timer`, and preserve the
password separately. The timer runs at 05:17 Malaysia time and retains the last 14
successful snapshots. This is a local backup; VPS/disk loss requires an offsite copy.
Check restore contents into a temporary root-only directory before declaring backup
verification complete. Do not overwrite live data during a restore test.

Before upgrading: back up data, save the old image ID and Compose files, build a
new pinned fork revision, then recreate only this stack. Roll back the image ID if
compatible; if the application migrated data incompatibly, restore the matching
snapshot while the app is stopped. Never delete volumes or alter other project data.

## Acceptance

- Valid owner JWT accepted; missing, forged, expired, wrong issuer, audience, or
  email rejected. Browser cross-origin requests rejected at Nginx.
- App and origin healthy; anonymous public requests reach Cloudflare login.
- Direct origin requests without signed identity fail, including all API paths.
- Owner browser can reach Studio; model configuration remains empty until user input.
- Restart preserves settings and project state; no paid generation is triggered.
- Local encrypted backup and restore test succeed; existing shared services remain healthy.
