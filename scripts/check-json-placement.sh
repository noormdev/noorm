#!/bin/bash
# check-json-placement.sh - guard against the broken root-level `--json` form in docs
#
# `noorm --json <cmd>` is silently swallowed by citty (no error, no JSON,
# default human output) — `--json` is a per-subcommand flag, not a root one.
# Only `<cmd> --json` works. This script fails the build if the broken form
# reappears in doc/skill/example prose outside the files that deliberately
# show it as a contrasted gotcha or a literal transcript.
#
# Usage:
#   bash scripts/check-json-placement.sh
#
set -e

PATTERN='noorm --json '
TARGETS=(README.md docs skills examples)

# Files that intentionally show the broken form: either contrasted directly
# against the correct form under a "does not work" heading, a literal shell
# transcript of a real bug-hunting session. `docs/spec/` is exempt wholesale —
# specs document the anti-pattern in prose by nature.
EXEMPT_REGEX='^(docs/cli/flags\.md|docs/guide/troubleshooting\.md|examples/llm-memory-db-mssql/mssql-problems\.md|examples/llm-memory-db-pg/REPORT\.md|examples/llm-memory-db-pg/REPORT-PHASE-1\.md|docs/spec/.*):'

MATCHES=$(grep -rn -- "$PATTERN" "${TARGETS[@]}" 2>/dev/null | grep -Ev "$EXEMPT_REGEX") || true

if [ -n "$MATCHES" ]; then

    echo "Found root-level 'noorm --json' placement (broken — --json must come after the subcommand):"
    echo "$MATCHES"
    exit 1

fi

echo "OK: no root-level 'noorm --json' occurrences found."
