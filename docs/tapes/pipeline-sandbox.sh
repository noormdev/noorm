#!/usr/bin/env bash
set -euo pipefail
TAPES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-run}"
case "$MODE" in run|history) ;; *) echo 'usage: bash pipeline-sandbox.sh [run|history]' >&2; exit 2 ;; esac
export NOORM_DEMO_ROOT=/tmp/noorm-demo-pipelines
export NOORM_DEMO_DATABASE=noorm_demo_pipelines
bash "$TAPES_DIR/sandbox.sh" seeded
export HOME="$NOORM_DEMO_ROOT/home"
export PATH="$NOORM_DEMO_ROOT/bin:$PATH"
cd "$NOORM_DEMO_ROOT/project"
for slug in close-period close-period-step; do
    mkdir -p "db/pipelines/$slug"
    cp "$TAPES_DIR/pipeline-project/$slug/pipeline.yml" "db/pipelines/$slug/"
    cp "$TAPES_DIR"/pipeline-project/*.sql.tmpl "db/pipelines/$slug/"
done
docker exec -i noorm-test-postgres psql -X -v ON_ERROR_STOP=1 -U noorm_test -d "$NOORM_DEMO_DATABASE" < "$TAPES_DIR/pipeline-project/seed.sql"
if [ "$MODE" = history ]; then
    # Seed only through execution: this earlier per-step failure retains its cache commit.
    code=0
    noorm pipeline run close-period-step --period 2026-11 --yes || code=$?
    if [ "$code" -ne 3 ]; then
        echo "error: expected partial-work exit 3, received $code" >&2
        exit 1
    fi
fi
printf 'pipeline sandbox ready (%s)\n' "$MODE"
