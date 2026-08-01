# Run and change flows against a live Postgres.
#
# This is the tape that carries noorm's actual argument: `run build` applies
# the SQL files as the current schema, `change ff` walks an existing database
# forward, and `change history` shows what ran. The sandbox starts already
# bootstrapped so the recording opens on the interesting part.

Source theme.tape

Output ../public/image/build-and-change.gif

Set Width 1600   # ~150 cols
Set Height 300   # ~10 lines; output never exceeds 8

Hide
# Strip coding-agent env vars so the recording shows a plain terminal and
# not whoever's shell happened to render it. See env-scrub.sh.
Type "source ./env-scrub.sh" Enter
Type "./sandbox.sh bootstrapped" Enter
Wait+Screen@180s /sandbox ready/
Type "export HOME=/tmp/noorm-demo/home" Enter
Type "cd /tmp/noorm-demo/project" Enter
Type "export PATH=/tmp/noorm-demo/bin:$PATH" Enter
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

Sleep 1s

# The SQL files define the schema. A fresh database gets there in one command.
Type "noorm run build" Sleep 500ms Enter
Wait+Screen@300s /Build completed/
Sleep 4s

Type "clear" Enter
Sleep 500ms

# Two changes ship with the demo schema, neither applied yet.
Type "noorm change list" Sleep 500ms Enter
Wait+Screen@60s /pending change/
Sleep 4s

# Fast-forward walks the existing database to current.
Type "noorm change ff --yes" Sleep 500ms Enter
Wait+Screen@300s /Fast-forward/
Sleep 6s

Type "clear" Enter
Sleep 500ms
Type "noorm change history" Sleep 500ms Enter
Sleep 2s

# Hold the final screen. PlaybackSpeed 2 halves playback, so this 12s of
# tape reads as ~6s in the GIF — long enough to take in the last frame
# before the loop restarts.
Sleep 12s
