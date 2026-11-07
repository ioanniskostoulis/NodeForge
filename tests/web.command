#!/bin/sh
# Double-click (or run) to try the current code as the web app: builds, serves and opens the
# browser at http://localhost:5174. Rebuilds and refreshes on every source change; stop with Ctrl+C.
cd "$(dirname "$0")/.." || exit 1
[ -d node_modules ] || npm install || exit 1
(until curl -s -o /dev/null http://localhost:5174; do sleep 1; done; open http://localhost:5174) &
exec npm run web
