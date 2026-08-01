# Stills for the Terminal UI page (docs/tui.md).
#
# This tape produces no GIF worth keeping — the Output below is a throwaway.
# The deliverables are the Screenshot PNGs, which replace the hand-drawn ASCII
# mockups that used to sit in tui.md and had already drifted from the real
# screens (the [c] Create label was wrong in both for a while).
#
# Run `./shots.sh` rather than calling vhs directly: it renders this tape and
# then crops each PNG down to its own content, since one tape has one canvas
# but the screens vary from ~14 to ~49 lines tall.
#
# Screen keys, from src/tui:
#   home    [r] Run  [c] Config  [g] Change  [d] DB  [+] More  [q] Quit
#   config  [a] Add
#   change  [f] FF  [h] History
#   db      [c] Create  [x] Explore
#   global  Shift+L log viewer, Shift+Q SQL terminal, ? help

Source theme.tape

Output ../../tmp/screenshots-throwaway.gif

# Tall enough for the add-config form, the tallest screen in the app. Every
# other shot gets cropped back down by shots.sh.
Set Width 1200
Set Height 1160
Set FontSize 15
Set TypingSpeed 90ms

Hide
Type "source ./env-scrub.sh" Enter
Type "./sandbox.sh built" Enter
Wait+Screen@180s /sandbox ready/
Type "export HOME=/tmp/noorm-demo/home" Enter
Type "cd /tmp/noorm-demo/project" Enter
Type "export PATH=/tmp/noorm-demo/bin:$PATH" Enter
# Apply one of the two changes so the Changes screen shows a real mix of
# applied and pending rather than an all-pending list.
Type "noorm change next --yes" Enter
Sleep 4s
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

Type "noorm ui" Enter
Sleep 5s
Screenshot shots/home.png
Sleep 2s

# ── Config ────────────────────────────────────────────────────────────────
Type "c"
Sleep 3s
Screenshot shots/config-list.png
Sleep 2s

Type "a"
Sleep 3s
Screenshot shots/config-add.png
Sleep 2s
Escape
Sleep 2s
Escape
Sleep 2s

# ── Changes ───────────────────────────────────────────────────────────────
Type "g"
Sleep 3s
Screenshot shots/changes-list.png
Sleep 2s

Type "h"
Sleep 4s
Screenshot shots/change-history.png
Sleep 2s
Escape
Sleep 2s
Escape
Sleep 2s

# ── Run ───────────────────────────────────────────────────────────────────
Type "r"
Sleep 3s
Screenshot shots/run-menu.png
Sleep 2s
Escape
Sleep 2s

# ── Database ──────────────────────────────────────────────────────────────
Type "d"
Sleep 3s
Screenshot shots/database-menu.png
Sleep 2s

Type "x"
Sleep 4s
Screenshot shots/explore-overview.png
Sleep 2s

Type "1"
Sleep 3s
Screenshot shots/explore-tables.png
Sleep 2s

Down
Sleep 600ms
Down
Sleep 1s
Enter
Sleep 4s
Screenshot shots/explore-table-detail.png
Sleep 2s
Escape
Sleep 1500ms
Escape
Sleep 1500ms
Escape
Sleep 2s

# ── Global overlays ───────────────────────────────────────────────────────
# Shift+Q opens the SQL terminal from anywhere; VHS has no Shift+ modifier, so
# an uppercase letter is how you send it (Ink reads the case as shift).
Type "Q"
Sleep 4s
Screenshot shots/sql-terminal.png
Sleep 2s
Escape
Sleep 2s

Type "L"
Sleep 3s
Screenshot shots/log-viewer.png
Sleep 2s
Type "L"
Sleep 2s
Escape
Sleep 2s

# ── Secondary screens ─────────────────────────────────────────────────────
# All reachable from Home directly, and also grouped under [+] More.
Type "+"
Sleep 3s
Screenshot shots/more-menu.png
Sleep 2s
Escape
Sleep 2s

Type "l"
Sleep 3s
Screenshot shots/lock.png
Sleep 2s
Escape
Sleep 2s

Type "s"
Sleep 3s
Screenshot shots/settings.png
Sleep 2s
Escape
Sleep 2s

Type "i"
Sleep 3s
Screenshot shots/identity.png
Sleep 2s
Escape
Sleep 2s

Type "v"
Sleep 3s
Screenshot shots/vault.png
Sleep 2s
Escape
Sleep 2s

# Secrets are per-config, so they hang off the config list rather than Home.
Type "c"
Sleep 2500ms
Type "k"
Sleep 3s
Screenshot shots/secrets.png
Sleep 2s
