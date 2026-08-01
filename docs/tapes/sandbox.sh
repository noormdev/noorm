#!/usr/bin/env bash
#
# Builds the isolated demo project the .tape files record against.
#
# Everything lands under /tmp/noorm-demo — a deliberately short path, because
# noorm's diagnostic log prints absolute file paths and a long prefix wraps
# every line in the recording.
#
# HOME is redirected into the sandbox so `noorm identity init` writes to
# $DEMO_ROOT/home/.noorm and never touches the real ~/.noorm.
#
# Usage:
#   ./sandbox.sh              # fresh project, no identity, no config
#   ./sandbox.sh bootstrapped # identity + config + schema already applied
#
set -euo pipefail

DEMO_ROOT="${NOORM_DEMO_ROOT:-/tmp/noorm-demo}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:-fresh}"

PG_CONTAINER="noorm-test-postgres"
PG_DB="noorm_demo"
PG_PORT=15432
PG_USER=noorm_test
PG_PASS=noorm_test

# The demo runs the built CLI, not a globally installed noorm, so a recording
# always reflects this working tree.
NOORM_BIN="$REPO_ROOT/dist/cli/index.js"

if [ ! -f "$NOORM_BIN" ]; then

    echo "error: $NOORM_BIN missing — run 'bun run build' first" >&2
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then

    echo "error: $PG_CONTAINER not running — start it with:" >&2
    echo "  docker compose -f docker-compose.test.yml up -d --wait postgres" >&2
    exit 1
fi

# Guard the destructive step: only ever remove a path we just derived from
# DEMO_ROOT, and only if it looks like our sandbox.
case "$DEMO_ROOT" in
    /tmp/*|"$TMPDIR"*) ;;
    *) echo "error: refusing to wipe '$DEMO_ROOT' — must live under /tmp" >&2; exit 1 ;;
esac

rm -rf "$DEMO_ROOT"
mkdir -p "$DEMO_ROOT/home" "$DEMO_ROOT/project" "$DEMO_ROOT/bin"

# A `noorm` on PATH backed by this working tree, so the run/change/TUI tapes
# record the code you have checked out rather than the last published release.
# VHS's Type command cannot contain escaped quotes, so the shim has to be a
# real file — a shell function defined inside the tape will not parse.
cat > "$DEMO_ROOT/bin/noorm" <<EOF
#!/usr/bin/env bash
exec node "$NOORM_BIN" "\$@"
EOF
chmod +x "$DEMO_ROOT/bin/noorm"

# 01-install.tape deliberately does NOT use the shim — it runs the real
# install.sh, which defaults to \$HOME/.local/bin and therefore stays inside
# the sandbox HOME.
mkdir -p "$DEMO_ROOT/home/.local/bin"

# Schema source. `demo` (default) is the 4-file project in demo-project/;
# `todo-db` is the full 60-file example.
#
# The default is deliberately small. noorm's diagnostic log prints one line per
# file, each carrying the absolute path twice (~250 chars), so 60 files means
# thousands of wrapped lines. VHS renders every frame, and a todo-db build does
# not finish inside a 5-minute wait — the recording times out before the build
# does. Four files keeps the GIF short, legible, and reproducible.
SCHEMA="${NOORM_DEMO_SCHEMA:-demo}"

case "$SCHEMA" in
    demo)
        cp -R "$(dirname "${BASH_SOURCE[0]}")/demo-project/sql" "$DEMO_ROOT/project/"
        cp -R "$(dirname "${BASH_SOURCE[0]}")/demo-project/changes" "$DEMO_ROOT/project/"
        ;;
    todo-db)
        cp -R "$REPO_ROOT/examples/todo-db/sql" "$DEMO_ROOT/project/"
        cp -R "$REPO_ROOT/examples/todo-db/changes" "$DEMO_ROOT/project/"
        ;;
    *)
        echo "error: unknown NOORM_DEMO_SCHEMA '$SCHEMA' (demo|todo-db)" >&2
        exit 1
        ;;
esac

# Always drop, so a recording never inherits objects from a previous take —
# that failure mode surfaces mid-build as "cannot drop columns from view".
#
# `project` mode stops there and leaves the database absent, because the TUI
# walkthrough creates it on camera via the db screen. Every other mode needs it
# to exist up front.
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $PG_DB;" >/dev/null

if [ "$MODE" != "project" ]; then

    docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres \
        -c "CREATE DATABASE $PG_DB;" >/dev/null
fi

# `project` stops after identity + `noorm init`: a real project with no config
# yet, which is where the TUI walkthrough starts (it creates the config itself).
if [ "$MODE" = "project" ]; then

    export HOME="$DEMO_ROOT/home"
    cd "$DEMO_ROOT/project"

    node "$NOORM_BIN" identity init \
        --name "Ada Lovelace" --email "ada@example.com" >/dev/null

    node "$NOORM_BIN" init --yes >/dev/null
fi

if [ "$MODE" = "bootstrapped" ] || [ "$MODE" = "built" ]; then

    export HOME="$DEMO_ROOT/home"
    cd "$DEMO_ROOT/project"

    node "$NOORM_BIN" identity init \
        --name "Ada Lovelace" --email "ada@example.com" >/dev/null

    # `noorm config add` is TUI-only, so a scripted bootstrap goes through
    # `ci init`, which reads the same connection details from NOORM_* env.
    NOORM_IDENTITY_PRIVATE_KEY="$(cat "$HOME/.noorm/identity.key")" \
    NOORM_IDENTITY_NAME="Ada Lovelace" \
    NOORM_IDENTITY_EMAIL="ada@example.com" \
    NOORM_CONNECTION_DIALECT=postgres \
    NOORM_CONNECTION_HOST=localhost \
    NOORM_CONNECTION_PORT="$PG_PORT" \
    NOORM_CONNECTION_DATABASE="$PG_DB" \
    NOORM_CONNECTION_USER="$PG_USER" \
    NOORM_CONNECTION_PASSWORD="$PG_PASS" \
        node "$NOORM_BIN" ci init --name dev --force >/dev/null
fi

# `built` also applies the schema, so the TUI opens on a real database instead
# of reporting "empty database" on its home screen. Changes stay pending — that
# is the state worth showing.
if [ "$MODE" = "built" ]; then

    node "$NOORM_BIN" run build >/dev/null 2>&1
fi

echo "sandbox ready at $DEMO_ROOT ($MODE)"
