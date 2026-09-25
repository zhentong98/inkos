#!/bin/bash
set -euo pipefail
umask 077
exec 9>/run/lock/inkos-backup.lock
flock -n 9 || exit 0
export RESTIC_REPOSITORY=/srv/inkos/backups
export RESTIC_PASSWORD_FILE=/etc/inkos/backup-password
scratch=$(mktemp -d /srv/inkos/.backup-stage.XXXXXX)
container=''
paused=0
cleanup() {
  if [ "$paused" = 1 ]; then docker unpause "$container" >/dev/null || true; fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT
container=$(docker compose --project-directory /etc/inkos ps -q app)
[ -n "$container" ] || { echo 'Inkos app is not running' >&2; exit 1; }
docker pause "$container" >/dev/null
paused=1
sync -f /srv/inkos/data
timeout 45 cp -a --reflink=auto /srv/inkos/data "$scratch/data"
docker unpause "$container" >/dev/null
paused=0
cp -a /etc/inkos "$scratch/config"
rm -f "$scratch/config/backup-password"
cd "$scratch"
restic backup --host inkos --tag inkos data config
restic forget --host inkos --tag inkos --group-by host,tags --keep-last 14 --prune
