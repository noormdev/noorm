#!/usr/bin/env bash
set -euo pipefail
TAPES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:?usage: bash pipeline-verify.sh dry|run|history}"
case "$MODE" in dry|run|history) ;; *) exit 2 ;; esac
if report=$(docker exec -i noorm-test-postgres psql -X -v ON_ERROR_STOP=1 -v mode="$MODE" \
    -U noorm_test -d noorm_demo_pipelines < "$TAPES_DIR/pipeline-project/verify.sql"); then
    printf 'Verified %s: history and business invariants\n' "$MODE"
else
    code=$?
    printf '%s\n' "$report" >&2
    exit "$code"
fi
