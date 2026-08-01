# The TUI (`noorm ui`) — a full walkthrough on a project with nothing set up:
# create a config, create the database, build the schema, fast-forward the
# changes, read the history, then browse the result in the explorer.
#
# Three things this tape has to respect that the CLI tapes do not:
#
#   1. Size is the composition, not a crop. Ink lays out against the terminal
#      it is handed and does not reflow afterwards. The add-config form is the
#      tallest screen (10 fields rendered at once, not as steps) and sets the
#      height for the whole recording.
#   2. Keys are not text. Single-key hotkeys need a Sleep after each one; Ink
#      repaints on its own schedule and a key sent mid-repaint is dropped.
#   3. In the form, Enter on a text field SUBMITS THE WHOLE FORM — it does not
#      advance. Only Tab and the arrow keys move between fields. Enter is
#      correct on a select (it confirms the option and advances) and on the
#      final checkbox (it submits). Getting this wrong silently creates a
#      half-filled config instead of failing loudly.
#
# Screen keys, from src/tui:
#   home    [r] Run  [c] Config  [g] Change  [d] DB  [q] Quit
#   config  [a] Add
#   run     [b] Build
#   change  [f] FF  [h] History
#   db      [c] Create  [x] Explore

Source theme.tape

Output ../public/image/tui.gif

Set Width 1200    # ~111 cols
Set Height 1160   # ~49 lines, sized to the add-config form
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

# Config Name — Tab, never Enter.
Type "dev"
Sleep 800ms
Tab
Sleep 1s

# Database Type — PostgreSQL is already highlighted; Enter confirms + advances.
Enter
Sleep 1200ms

# Host — "localhost" is prefilled, so Tab straight past it.
Tab
Sleep 800ms

# Port — the 5432 shown is a placeholder, not a value; the test container is
# on 15432 and leaving this blank yields a config that cannot connect.
Type "15432"
Sleep 800ms
Tab
Sleep 600ms

Type "noorm_demo"
Sleep 800ms
Tab
Sleep 600ms

Type "noorm_test"
Sleep 800ms
Tab
Sleep 600ms

Type "noorm_test"
Sleep 800ms
Tab
Sleep 1s

# User Role — Admin at the terminal.
Enter
Sleep 1200ms

# Agent Role — already Viewer: DEFAULT_ACCESS is { user: 'admin', agent:
# 'viewer' }, so an agent gets read-only against this config out of the box.
# That access split is the point, so just confirm it.
#
# Do not "helpfully" arrow to Viewer here. This tape used to press Up twice to
# get there from Admin, which was correct until the default changed; the same
# two presses now wrap round to Admin and hand an agent full access while the
# recording still claims read-only. Selects follow the default, not a position.
Enter
Sleep 1200ms

# Test Database — Space toggles, Enter submits the form.
Space
Sleep 1s
Enter
Sleep 4s

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
# walkthrough in one screen.
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
