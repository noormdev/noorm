# The TUI (`noorm ui`) — a full walkthrough on a project with nothing set up:
# create a config, create the database, build the schema, fast-forward the
# changes, read the history, then browse the result in the explorer.
#
# Screen waits gate navigation and outcomes; sleeps keep each action readable
# at 2× playback. Form fields use Enter to edit/commit, then Down to move.
# Submission lives on the action row, not on the last field.
#
# Home: [r] Run  [p] Pipelines  [c] Config  [g] Change  [d] DB
# Actions return to their list with Escape, then Home with a second Escape.

Source theme.tape

Output ../public/image/tui.gif

Set Width 1200    # 111 cols
Set Height 700    # 32 lines — measured with `tput lines`, not derived
Set FontSize 15
Set TypingSpeed 90ms
Env CI "false"
Env FORCE_COLOR "1"

Hide
# Strip coding-agent env vars so the recording shows a plain terminal and
# not whoever's shell happened to render it. See env-scrub.sh.
Type "source ./env-scrub.sh" Enter
# `project` leaves a real project with an identity but no config and no
# database — everything below is created on camera.
Type "./sandbox.sh project" Enter
Wait+Screen@180s /sandbox ready at .*noorm-demo \(project\)/
Type "export HOME=/tmp/noorm-demo/home" Enter
Type "cd /tmp/noorm-demo/project" Enter
Type "export PATH=/tmp/noorm-demo/bin:$PATH" Enter
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

Sleep 1s
Type "noorm ui" Sleep 500ms Enter
Wait+Screen@30s /No database configurations found\./
Sleep 3s

# ── Config ────────────────────────────────────────────────────────────────
Type "c"
Wait+Screen@10s /No configurations found\./
Sleep 1500ms
Type "a"
Wait+Screen@10s /Add Configuration/
Wait+Screen@10s /› Config Name/
Wait+Screen@10s /User Role\s+Admin/
Wait+Screen@10s /Agent Role\s+Viewer/
Sleep 2s

# Config Name. Enter opens the field, Enter commits it, ↓ moves on. That is
# the loop for every field below; only the select and the checkbox differ.
Enter
Wait+Screen@10s /commit.*esc revert/
Sleep 500ms
Type "dev"
Sleep 800ms
Enter
Sleep 800ms
Down
Wait+Screen@10s /› Database Type/
Sleep 500ms

# Database Type. A select collapses to its current value until it is opened,
# so Enter expands the four dialects and a second Enter takes the highlighted
# one. PostgreSQL is already the value, so this is a confirmation, not a pick.
Enter
Wait+Screen@10s /SQL Server/
Sleep 1s
Enter
Sleep 1000ms

# Host is prefilled with `localhost`, so pass over it.
Down
Sleep 700ms
Down
Sleep 700ms

# Port. The 5432 shown is the placeholder, not a value; the test container is
# on 15432 and leaving this blank yields a config that cannot connect.
Wait+Screen@10s /› Port/
Enter
Sleep 500ms
Type "15432"
Sleep 800ms
Enter
Sleep 700ms
Down
Sleep 600ms

Wait+Screen@10s /› Database\*\s/
Enter
Sleep 500ms
Type "noorm_demo"
Sleep 800ms
Enter
Sleep 700ms
Down
Sleep 600ms

Wait+Screen@10s /› Username/
Enter
Sleep 500ms
Type "noorm_test"
Sleep 800ms
Enter
Sleep 700ms
Down
Sleep 600ms

Wait+Screen@10s /› Password/
Enter
Sleep 500ms
Type "noorm_test"
Sleep 800ms
Enter
Sleep 900ms

# Preserve the actual user Admin / agent Viewer defaults; don't select roles
# by option position, which can silently grant the wrong access after a change.
Down
Wait+Screen@10s /› User Role\s+Admin/
Sleep 700ms
Down
Wait+Screen@10s /› Agent Role\s+Viewer/
Sleep 700ms
Down
Wait+Screen@10s /› Test Database/
Sleep 900ms

# Test Database. A checkbox has nothing to type into, so Space (or Enter)
# toggles it in place.
Space
Wait+Screen@10s /Test Database\s+☑ Yes/
Sleep 1200ms

# Past the last field is the action row. This is where the form is submitted.
Down
Wait+Screen@10s /❯ \[ Create Config \]/
Sleep 1500ms
Enter
Wait+Screen@30s /Configurations/
Wait+Screen@10s /dev.*postgres.*\(active\).*\[test\]/
Sleep 3s

Escape
Wait+Screen@10s /\[p\] Pipelines/
Sleep 2s

# ── Create the database ───────────────────────────────────────────────────
Type "d"
Wait+Screen@30s /Database Operations/
Wait+Screen@10s /\[c\] Create/
Sleep 2s
Type "c"
Wait+Screen@30s /Create database "noorm_demo" and initialize tracking tables\?/
Sleep 2s
Type "y"
Wait+Screen@60s /Database noorm_demo is ready\./
Sleep 3s
Escape
Wait+Screen@30s /Tracking Tables:\s+Initialized/
Sleep 1500ms
Escape
Wait+Screen@10s /\[p\] Pipelines/
Sleep 2s

# ── Build the schema ──────────────────────────────────────────────────────
# Both actions require their own confirmation before any SQL runs.
Type "r"
Wait+Screen@10s /Run SQL Files/
Wait+Screen@10s /\[b\] Build/
Sleep 1500ms
Type "b"
Wait+Screen@30s /Run 4 SQL files on dev\?/
Sleep 2s
Type "y"
Wait+Screen@90s /Build Complete/
Wait+Screen@10s /Status:\s+SUCCESS/
Wait+Screen@10s /4 run\s+0 skipped\s+0 failed/
Sleep 4s
Escape
Wait+Screen@10s /Run SQL Files/
Sleep 1500ms
Escape
Wait+Screen@10s /\[p\] Pipelines/
Sleep 2s

# ── Apply the changes ─────────────────────────────────────────────────────
Type "g"
Wait+Screen@30s /Total:\s+2\s+Applied:\s+0\s+Pending:\s+2/
Sleep 2s
Type "f"
Wait+Screen@30s /Apply 2 pending change\(s\):/
Wait+Screen@10s /Apply all pending changes\?/
Sleep 2s
Type "y"
Wait+Screen@90s /Applied 2 change\(s\) successfully!/
Sleep 4s
Escape
Wait+Screen@30s /Total:\s+2\s+Applied:\s+2\s+Pending:\s+0/
Sleep 2s

# History of what ran — [h] from the change list, so only one Escape back.
Type "h"
Wait+Screen@30s /Execution History/
Wait+Screen@10s /Total:\s+3\s+Changes:\s+2\s+Builds:\s+1\s+Runs:\s+0\s+Success:\s+3/
Sleep 5s
Escape
Wait+Screen@30s /Total:\s+2\s+Applied:\s+2\s+Pending:\s+0/
Sleep 1500ms
Escape
Wait+Screen@10s /\[p\] Pipelines/
Sleep 2s

# ── Explore the result ────────────────────────────────────────────────────
Type "d"
Wait+Screen@30s /Tracking Tables:\s+Initialized/
Sleep 2s
Type "x"
Wait+Screen@30s /DB Explore/
Wait+Screen@10s /Total Objects:/
Sleep 3s

# The schema is already current; changes reconcile that same desired state.
# Finish on task's inherited compound key and constrained priority column.
Type "1"
Wait+Screen@30s /Tables \(3\)/
Sleep 2s
Down
Wait+Screen@10s /❯.*public\.project/
Sleep 700ms
Down
Wait+Screen@10s /❯.*public\.task/
Sleep 1200ms
Enter
Wait+Screen@30s /Columns \(6\)/
Wait+Screen@10s /priority\s+integer/
Wait+Screen@10s /task_pkey/
Sleep 3s

# Hold the final screen. PlaybackSpeed 2 halves playback, so this 12s of
# tape reads as ~6s in the GIF — long enough to take in the last frame
# before the loop restarts.
Sleep 12s
