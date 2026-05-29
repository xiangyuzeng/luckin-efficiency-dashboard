#!/usr/bin/env bash
# Realtime refresh — runs the lightweight backlog snapshot and commits data/realtime.json.
# Intended cadence: GitHub Actions cron */15 * * * *.

set -euo pipefail

cd "$(dirname "$0")/.."

NO_PUSH=0
for arg in "$@"; do
  case "$arg" in
    --no-push) NO_PUSH=1 ;;
  esac
done

echo "[refresh-realtime] running realtime_collector.py"
python3 pipeline/realtime_collector.py

if [[ "$NO_PUSH" == "1" ]]; then
  echo "[refresh-realtime] --no-push set, skipping git push"
  exit 0
fi

# realtime_collector.py also upserts today's rows into data/efficiency.json
# (intra-day intervals). Include that file in the commit so Vercel sees fresh
# half-hour slots without waiting for the next daily refresh.
CHANGED=()
git diff --quiet -- data/realtime.json   || CHANGED+=(data/realtime.json)
git diff --quiet -- data/efficiency.json || CHANGED+=(data/efficiency.json)

if [[ ${#CHANGED[@]} -gt 0 ]]; then
  echo "[refresh-realtime] committing ${CHANGED[*]}"
  git add "${CHANGED[@]}"
  git commit -m "data: realtime $(date -u +'%Y-%m-%dT%H:%MZ')"
  git push
else
  echo "[refresh-realtime] no changes to commit"
fi
