# shellcheck shell=bash
# Sourced (not executed) by every tape before recording starts.
#
# `noorm info` reports a detected coding agent, e.g. "Agent: Claude Code
# (CLAUDECODE, CLAUDE_CODE_ENTRYPOINT)". That reflects whoever rendered the
# GIF, not anything about noorm, so it must not end up in a published asset.
#
# Matched by pattern rather than an explicit list: agent detection lives in the
# released binary, which moves independently of this repo, so a hardcoded list
# would silently rot the next time a vendor adds a variable.

# -E (ERE) is required: BSD/macOS sed does not support \| alternation in BRE,
# so the basic-regex form matches nothing here and silently scrubs nothing.
for _noorm_tape_var in $(
    env | sed -nE 's/^(CLAUDE[A-Z_0-9]*|AI_AGENT|CURSOR[A-Z_0-9]*|AIDER[A-Z_0-9]*|COPILOT[A-Z_0-9]*|WARP[A-Z_0-9]*|TERM_PROGRAM[A-Z_0-9]*)=.*/\1/p'
); do
    unset "$_noorm_tape_var"
done

unset _noorm_tape_var
