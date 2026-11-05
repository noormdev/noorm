#!/bin/sh
# Run both release architectures on Alpine (Docker needs ARM64 emulation on x64).
set -eu

for arch in x64 arm64; do
    case "$arch" in
        x64) platform=linux/amd64 ;;
        arm64) platform=linux/arm64 ;;
    esac

    echo "Testing Alpine 3.22 ($arch)..."
    docker run --rm --platform "$platform" \
        -v "$(pwd)/packages/cli/bin:/artifacts:ro" \
        -e "NOORM_BINARY=/artifacts/noorm-linux-${arch}-musl" \
        alpine:3.22 sh -ec '
            apk add --no-cache libstdc++
            "$NOORM_BINARY" --version
            "$NOORM_BINARY" --help >/dev/null
            export NOORM_CONNECTION_DIALECT=sqlite
            export NOORM_CONNECTION_DATABASE=/tmp/noorm-smoke.db
            "$NOORM_BINARY" sql query "CREATE TABLE smoke (value INTEGER)" --json
            "$NOORM_BINARY" sql query "INSERT INTO smoke VALUES (42)" --json
            result=$("$NOORM_BINARY" sql query "SELECT value FROM smoke" --json)
            echo "$result"
            echo "$result" | grep -q '\''"rows":\[{"value":42}\]'\''
            if "$NOORM_BINARY" sql query "SELECT * FROM missing_table" --json; then
                echo "Invalid SQL unexpectedly succeeded" >&2
                exit 1
            fi
        '
done
