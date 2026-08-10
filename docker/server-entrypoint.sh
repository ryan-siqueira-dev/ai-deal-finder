#!/bin/sh
set -eu
umask 077

encoded_database_password="$(node -e 'process.stdout.write(encodeURIComponent(process.env.POSTGRES_PASSWORD || ""))')"
export DATABASE_URL="postgresql://${DATABASE_USER:-deal_finder}:${encoded_database_password}@${DATABASE_HOST:-postgres}:${DATABASE_PORT:-5432}/${DATABASE_NAME:-deal_finder}?schema=public"
unset encoded_database_password
unset POSTGRES_PASSWORD

display_number="${DISPLAY_NUMBER:-99}"
export DISPLAY=":${display_number}"

mkdir -p "${HOME:-/tmp/ai-deal-finder-home}"
chmod 700 "${HOME:-/tmp/ai-deal-finder-home}"

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

for writable_directory in /app/data /app/.runtime; do
  if [ ! -w "$writable_directory" ]; then
    echo "$writable_directory is not writable by the application user" >&2
    exit 1
  fi
done

if [ "${VNC_ENABLED:-false}" = "true" ]; then
  vnc_password=""
  if [ -n "${VNC_PASSWORD_FILE:-}" ]; then
    if [ ! -f "$VNC_PASSWORD_FILE" ] || [ ! -r "$VNC_PASSWORD_FILE" ]; then
      echo "VNC_PASSWORD_FILE must point to a readable regular file" >&2
      exit 1
    fi
    IFS= read -r vnc_password < "$VNC_PASSWORD_FILE" || {
      if [ -z "$vnc_password" ]; then
        echo "VNC_PASSWORD_FILE is empty" >&2
        exit 1
      fi
    }
  else
    vnc_password="${VNC_PASSWORD:-}"
  fi
  unset VNC_PASSWORD

  if ! printf '%s\n' "$vnc_password" | LC_ALL=C grep -Eq '^[!-~]{8}$'; then
    echo "The VNC password must contain exactly 8 printable ASCII characters" >&2
    echo "Classic RFB authentication ignores bytes after the eighth and does not encrypt the session" >&2
    exit 1
  fi

  vnc_auth_file="$(mktemp /dev/shm/ai-deal-finder-vnc.XXXXXX)"
  if ! printf '%s\n%s\ny\n' "$vnc_password" "$vnc_password" \
    | x11vnc -storepasswd "$vnc_auth_file" >/dev/null 2>&1; then
    rm -f "$vnc_auth_file"
    unset vnc_password
    echo "x11vnc could not create the RFB authentication file" >&2
    exit 1
  fi
  unset vnc_password
  chmod 600 "$vnc_auth_file"
  echo "VNC enabled with classic RFB authentication; keep access on loopback or inside an encrypted tunnel" >&2
  x11vnc \
    -display "$DISPLAY" \
    -forever \
    -shared \
    -rfbport 5900 \
    -listen 0.0.0.0 \
    -rfbauth "$vnc_auth_file" \
    -disablefiletransfer \
    -noremote \
    -nocmds \
    -quiet &
fi
unset VNC_PASSWORD

npx prisma migrate deploy
if [ "$#" -eq 0 ]; then
  set -- node dist/index.js
fi
exec "$@"
