#!/bin/sh
# Starts Chart Journal at http://localhost:5173 (Ctrl+C to stop)
# Port 5173 is fixed in the PersonalOS registry; if it's taken we stop instead of picking another.
cd "$(dirname "$0")" || exit 1
PORT=5173
URL="http://localhost:$PORT"

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1
  else
    return 1
  fi
}

if port_in_use; then
  echo "Chart Journal needs port $PORT, but something is already using it." >&2
  echo "Stop that program (or an older Chart Journal window), then run this again." >&2
  echo "See what it is:  lsof -nP -iTCP:$PORT -sTCP:LISTEN" >&2
  exit 1
fi

echo "Chart Journal running at $URL  (press Ctrl+C to stop)"
( sleep 1; if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi ) >/dev/null 2>&1 &
# serve.py = python's http.server plus "Cache-Control: no-store", so the browser never shows an old app.js (serve.json does the same for the npx fallback)
if command -v python3 >/dev/null 2>&1; then
  PORT="$PORT" exec python3 serve.py
else
  exec npx --yes serve -l "$PORT" .
fi
