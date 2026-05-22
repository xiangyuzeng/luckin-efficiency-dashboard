#!/usr/bin/env bash
# Daily refresh — runs the full collector → formatter chain and commits data/efficiency.json.
#
# Flags:
#   --no-push   Skip the git commit/push step (useful for local dry runs)
#
# Fails-fast on any sub-step; the workflow caller picks up the non-zero exit code.

set -euo pipefail

cd "$(dirname "$0")/.."

NO_PUSH=0
for arg in "$@"; do
  case "$arg" in
    --no-push) NO_PUSH=1 ;;
  esac
done

echo "[refresh] running schema_probe.py"
python3 pipeline/schema_probe.py || echo "[refresh] schema_probe warned — see pipeline/schema_map.json"

echo "[refresh] running frontend_formatter.py (collector + formatter)"
python3 pipeline/frontend_formatter.py

if [[ "$NO_PUSH" == "1" ]]; then
  echo "[refresh] --no-push set, skipping git push"
  exit 0
fi

if ! git diff --quiet -- data/efficiency.json pipeline/schema_map.json; then
  echo "[refresh] committing data/efficiency.json + schema_map.json"
  git add data/efficiency.json pipeline/schema_map.json
  git commit -m "data: daily refresh $(date -u +'%Y-%m-%dT%H:%MZ')"
  git push
else
  echo "[refresh] no changes to commit"
fi
