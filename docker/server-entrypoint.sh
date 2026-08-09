#!/bin/sh
set -eu

display_number="${DISPLAY_NUMBER:-99}"
export DISPLAY=":${display_number}"

Xvfb "$DISPLAY" -screen 0 "${XVFB_SCREEN:-1920x1080x24}" -nolisten tcp -ac &

attempt=0
while [ ! -S "/tmp/.X11-unix/X${display_number}" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo "Xvfb did not become ready" >&2
    exit 1
  fi
  sleep 0.1
done

if [ "${VNC_ENABLED:-true}" = "true" ]; then
  x11vnc -display "$DISPLAY" -forever -shared -rfbport 5900 -listen 0.0.0.0 -nopw -quiet &
fi

npx prisma migrate deploy
exec node dist/index.js
