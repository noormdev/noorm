#!/bin/bash
# check-flag-placement.sh - guard against root-level flags (other than -c/--cwd) in docs
#
# `extractGlobalCwd` (src/cli/index.ts) hoists only `-c`/`--cwd` out of argv
# before citty dispatch. citty forwards only `rawArgs.slice(subCommandArgIndex
# + 1)` to the resolved subcommand, so every other flag typed before the
# subcommand — `--config`, `--force`, `--dry-run`, `--json`, `--yes`/`-y` — is
# rejected outright with "Unrecognized flag … before the subcommand". Only
# placing the flag after the subcommand (`noorm run build --dry-run`) works.
#
# `-c`/`--cwd` is the sole exception, for two reasons: it is consumed before
# dispatch (it sets the working directory everything else resolves against),
# and `-c` already means `--config` after the subcommand — see the
# "`--config` / `-c` overload" note in docs/cli/flags.md. Hoisting any other
# flag would either collide with that overload or just add a declaration
# site without a reason: a flag goes on the command that uses it.
#
# This script fails the build if a broken root-level form reappears in
# doc/skill/example prose outside the files that deliberately show it as a
# contrasted gotcha ("does not work" vs. "works") rather than instructing
# the reader to actually type it.
#
# Usage:
#   bash scripts/check-flag-placement.sh
#
set -e

PATTERNS=('noorm --config ' 'noorm --force' 'noorm --dry-run' 'noorm --json' 'noorm --yes' 'noorm -y ')
TARGETS=(README.md docs skills examples)

# Files that intentionally show the broken form, contrasted directly against
# the correct form under a "does not work"/overload-explainer heading:
# - docs/guide/troubleshooting.md: the flag-placement entry contrasts broken vs. working forms
# - docs/cli/flags.md: the placement explainer and `--config`/`-c` overload section contrast the two forms
# - docs/dev/headless.md: the CLI-architecture page documents extractGlobalCwd by
#   showing the rejected form next to the error it produces, under a "Rejected:" comment
# - docs/design/v1-49-54-cli-field-defects.md: this checkpoint's own design doc, which
#   narrates the "form that cannot work" as the defect under investigation
# - examples/llm-memory-db-pg/{REPORT.md,REPORT-PHASE-1.md,postgres-problems.md}: dated
#   investigation logs from a consuming example project (predate this branch — see git log),
#   already stating the "must come after the subcommand" rule as a quirk they hit
# - examples/llm-memory-db-mssql/mssql-problems.md: same — a dated repro transcript, not
#   instructional prose, predating this branch
EXEMPT_REGEX='^(docs/guide/troubleshooting\.md|docs/cli/flags\.md|docs/dev/headless\.md|docs/design/v1-49-54-cli-field-defects\.md|examples/llm-memory-db-pg/(REPORT\.md|REPORT-PHASE-1\.md|postgres-problems\.md)|examples/llm-memory-db-mssql/mssql-problems\.md):'

FAILED=0

for PATTERN in "${PATTERNS[@]}"; do

    MATCHES=$(grep -rn -- "$PATTERN" "${TARGETS[@]}" 2>/dev/null | grep -Ev "$EXEMPT_REGEX") || true

    if [ -n "$MATCHES" ]; then

        echo "Found root-level '$PATTERN' placement (broken — flag must come after the subcommand):"
        echo "$MATCHES"
        FAILED=1

    fi

done

if [ "$FAILED" -ne 0 ]; then
    exit 1
fi

echo "OK: no broken root-level flag placement found."
