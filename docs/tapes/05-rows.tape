# Reading rows from the schema explorer: peek at both ends of a table, then
# open one row as a document.
#
# Separate from 03-tui.tape rather than appended to it, for two reasons:
#
#   1. It needs data. 03 records the `project` sandbox and creates everything on
#      camera, so its tables are empty by construction — a peek there shows "All
#      0 rows". This tape uses the `seeded` mode, which loads demo-project/
#      seed.sql after the build.
#   2. 03 is already a six-step walkthrough. Appending a seventh step to a GIF
#      that loops buys reach for the one feature at the cost of every feature
#      before it, because nobody watches to the end of a two-minute loop.
#
# The table truncates `title` to fit six columns across; that is not a defect
# to work around, it is the reason the row view exists, and the tape shows the
# two in sequence.
#
# Screen keys, from src/tui:
#   db      [x] Explore
#   detail  [v] Full text  [r] Rows
#   peek    [↑↓] Row  [Tab] Set  [↵] Open row
#   row     [←→] Row  [↑↓] Scroll  [f] YAML/JSON

Source theme.tape

Output ../public/image/tui-rows.gif

Set Width 1200    # 111 cols
Set Height 700    # 32 lines — measured with `tput lines`, not derived
Set FontSize 15
Set TypingSpeed 90ms

Hide
# Strip coding-agent env vars so the recording shows a plain terminal and not
# whoever's shell happened to render it. See env-scrub.sh. This one is load
# bearing beyond cosmetics: a detected harness puts the CLI on the `agent`
# channel, whose default role is `viewer`, and sandbox.sh's `run build` is
# refused outright.
Type "source ./env-scrub.sh" Enter
Type "./sandbox.sh seeded" Enter
Wait+Screen@180s /sandbox ready/
Type "export HOME=/tmp/noorm-demo/home" Enter
Type "cd /tmp/noorm-demo/project" Enter
Type "export PATH=/tmp/noorm-demo/bin:$PATH" Enter
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

Sleep 1s
Type "noorm ui" Sleep 500ms Enter
Sleep 4s

# ── Down to the task table ────────────────────────────────────────────────
Type "d"
Sleep 2s
Type "x"
Sleep 3500ms
Type "1"
Sleep 2500ms
Down
Sleep 700ms
Down
Sleep 1200ms
Enter
Sleep 3500ms

# ── Peek at both ends ─────────────────────────────────────────────────────
# `r`, not `p`: `r` already means re-run, rename and transfer elsewhere, and
# this key is screen-local. The read is gated on sql:read rather than explore,
# because reading rows through a schema-only permission would be a hole.
#
# Two sets appear only when the table holds more rows than the viewport can
# read at both ends; a short table collapses to one "All N rows" table.
Type "r"
Sleep 4s

Down
Sleep 1200ms

# ── One row as a document ─────────────────────────────────────────────────
# Enter opens the highlighted row with nothing truncated. `f` swaps YAML for
# JSON and back, and the choice sticks for the rest of the session.
Enter
Sleep 3500ms
Type "f"
Sleep 3500ms

# ←/→ walk the rows the table was showing — filtered and sorted, so the viewer
# moves through what the reader can see rather than through what was fetched.
Right
Sleep 2500ms
Left
Sleep 1500ms
Left
Sleep 2500ms

# ── Back out to the other end of the table ────────────────────────────────
Escape
Sleep 2500ms
Tab
Sleep 2500ms
Enter
Sleep 3500ms

# Hold the final screen. PlaybackSpeed 2 halves playback, so this 10s of tape
# reads as ~5s in the GIF — long enough to read the last row before the loop
# restarts.
Sleep 10s
