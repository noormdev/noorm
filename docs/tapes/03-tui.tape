# The TUI (`noorm ui`) — a full walkthrough on a project with nothing set up:
# create a config, create the database, build the schema, fast-forward the
# changes, read the history, then browse the result in the explorer.
#
# Three things this tape has to respect that the CLI tapes do not:
#
#   1. Size is the whole frame, not a crop. The TUI renders into the alternate
#      screen and draws to the full terminal height, so the canvas below is the
#      shell: breadcrumb pinned to the top, status bar pinned to the bottom, and
#      whatever the screen needs in between. A taller canvas is not more room
#      for content, it is more empty room.
#   2. Keys are not text. Single-key hotkeys need a Sleep after each one; Ink
#      repaints on its own schedule and a key sent mid-repaint is dropped.
#   3. The form has two modes, and Enter is the switch between them. In browse
#      mode ↑/↓ move between fields — every field type, selects included — and
#      Enter opens the active field. In edit mode the field owns the keyboard,
#      and Enter commits back to browse. Typing without opening the field first
#      does not error: the characters land on the browse handler, which ignores
#      them, and the recording shows an empty form being submitted.
#
#      Submit is not a key any more. Past the last field the cursor lands on the
#      [ Create Config ] / [ Cancel ] action row, and Enter there is what saves.
#
# Screen keys, from src/tui:
#   home    [r] Run  [c] Config  [g] Change  [d] DB  [q] Quit
#   config  [a] Add
#   run     [b] Build
#   change  [f] FF  [h] History
#   db      [c] Create  [x] Explore

Source theme.tape

Output ../public/image/tui.gif

Set Width 1200    # 111 cols
Set Height 700    # 32 lines — measured with `tput lines`, not derived
Set FontSize 15
Set TypingSpeed 90ms

Hide
# Strip coding-agent env vars so the recording shows a plain terminal and
# not whoever's shell happened to render it. See env-scrub.sh.
Type "source ./env-scrub.sh" Enter
# `project` leaves a real project with an identity but no config and no
# database — everything below is created on camera.
Type "./sandbox.sh project" Enter
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

# ── Config ────────────────────────────────────────────────────────────────
Type "c"
Sleep 2s
Type "a"
Sleep 2500ms

# Config Name. Enter opens the field, Enter commits it, ↓ moves on. That is
# the loop for every field below; only the select and the checkbox differ.
Enter
Sleep 800ms
Type "dev"
Sleep 800ms
Enter
Sleep 800ms
Down
Sleep 800ms

# Database Type. A select collapses to its current value until it is opened,
# so Enter expands the four dialects and a second Enter takes the highlighted
# one. PostgreSQL is already the value, so this is a confirmation, not a pick.
Enter
Sleep 1500ms
Enter
Sleep 1000ms

# Host is prefilled with `localhost`, so pass over it.
Down
Sleep 700ms
Down
Sleep 700ms

# Port. The 5432 shown is the placeholder, not a value; the test container is
# on 15432 and leaving this blank yields a config that cannot connect.
Enter
Sleep 500ms
Type "15432"
Sleep 800ms
Enter
Sleep 700ms
Down
Sleep 600ms

Enter
Sleep 500ms
Type "noorm_demo"
Sleep 800ms
Enter
Sleep 700ms
Down
Sleep 600ms

Enter
Sleep 500ms
Type "noorm_test"
Sleep 800ms
Enter
Sleep 700ms
Down
Sleep 600ms

Enter
Sleep 500ms
Type "noorm_test"
Sleep 800ms
Enter
Sleep 900ms

# User Role, then Agent Role. Both already hold their defaults —
# DEFAULT_ACCESS is { user: 'admin', agent: 'viewer' }, so an agent gets
# read-only against this config out of the box. That access split is the
# point, so ↓ past them rather than opening either.
#
# Do not "helpfully" open the Agent Role select and arrow to Viewer. An
# earlier tape pressed Up twice to reach it from Admin, which was correct
# until the default changed; the same two presses then wrapped round to Admin
# and handed an agent full access while the recording still claimed
# read-only. Selects follow the default, not a position.
Down
Sleep 700ms
Down
Sleep 700ms
Down
Sleep 900ms

# Test Database. A checkbox has nothing to type into, so Space (or Enter)
# toggles it in place.
Space
Sleep 1200ms

# Past the last field is the action row. This is where the form is submitted.
Down
Sleep 1500ms
Enter
Sleep 5s

Escape
Sleep 2s

# Navigation is two levels deep everywhere below: Home -> list -> action. One
# Escape backs out of the action to the list, a second returns to Home. Getting
# this count wrong does not error, it just lands on the list screen and the next
# hotkey means something else there — a single missing Escape sends "r" to the
# DB list, where it opens Data Transfer instead of Run.

# ── Create the database ───────────────────────────────────────────────────
Type "d"
Sleep 2500ms
Type "c"
Sleep 2500ms
Type "y"
Sleep 5s
Escape
Sleep 1500ms
Escape
Sleep 2s

# ── Build the schema ──────────────────────────────────────────────────────
# Build and fast-forward both gate on a confirm ("Run 4 SQL files on dev?").
# Skipping the "y" does not error — Escape just cancels, and the recording
# looks like it worked while the database stays empty.
Type "r"
Sleep 2s
Type "b"
Sleep 2500ms
Type "y"
Sleep 6s
Escape
Sleep 1500ms
Escape
Sleep 2s

# ── Apply the changes ─────────────────────────────────────────────────────
Type "g"
Sleep 3s
Type "f"
Sleep 2500ms
Type "y"
Sleep 6s
Escape
Sleep 2s

# History of what ran — [h] from the change list, so only one Escape back.
Type "h"
Sleep 5s
Escape
Sleep 1500ms
Escape
Sleep 2s

# ── Explore the result ────────────────────────────────────────────────────
Type "d"
Sleep 2500ms
Type "x"
Sleep 5s

# [1] Tables, then down to `task` — the payoff table. Its detail shows both the
# inherited compound key (user_id + created_at + task_index, no surrogate id)
# and the `priority` column the fast-forward just added, which is the whole
# walkthrough in one screen. Its footer advertises [r] Rows; that is
# 05-rows.tape.
Type "1"
Sleep 3s
Down
Sleep 700ms
Down
Sleep 1200ms
Enter
Sleep 3s

# Hold the final screen. PlaybackSpeed 2 halves playback, so this 12s of
# tape reads as ~6s in the GIF — long enough to take in the last frame
# before the loop restarts.
Sleep 12s
