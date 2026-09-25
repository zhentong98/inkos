#!/bin/sh
set -eu
umask 077
mkdir -p "$HOME"
if [ ! -f /data/inkos.json ]; then
  node /app/dist/index.js init /data --lang en
fi
exec node /app/node_modules/@actalk/inkos-studio/dist/api/index.js /data
