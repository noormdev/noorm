# Install flow: get the binary, create an identity, bootstrap a project.
#
# `noorm init` is a real @clack/prompts wizard — the Type/Enter pairs below are
# answering its "display name" and "email" prompts, not printing decoration.
# Because no identity exists yet in the sandbox, init asks for one; if you
# reorder this after `identity init` the wizard skips both prompts and the
# keystrokes would leak into the shell.

Source theme.tape

Output ../public/image/install.gif

Set Width 1600   # ~150 cols
Set Height 460   # ~18 lines

# Off-camera: build the sandbox and enter it. HOME is redirected so the
# recording never reads or writes the real ~/.noorm.
Hide
# Strip coding-agent env vars so the recording shows a plain terminal and
# not whoever's shell happened to render it. See env-scrub.sh.
Type "source ./env-scrub.sh" Enter
Type "./sandbox.sh fresh" Enter
Wait+Screen@180s /sandbox ready/
Type "export HOME=/tmp/noorm-demo/home" Enter
Type "cd /tmp/noorm-demo/project" Enter
Type "export PATH=$HOME/.local/bin:$PATH" Enter
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

Sleep 1s

Type "curl -fsSL https://noorm.dev/install.sh | sh" Sleep 500ms Enter

# The installer prints "Installing ..." immediately, then spends ~15s pulling a
# 67 MB binary from GitHub before printing "Installed ...". That transfer was
# roughly half the finished GIF, all of it a motionless screen.
#
# So: catch the "Installing" line on camera, stop capturing across the
# transfer, and resume once the binary has landed. Nothing is faked — the
# output is the real installer's, and the frames that get dropped are the ones
# where nothing changes. Hide only suspends capture; Wait still works inside it.
Wait+Screen@60s /Installing noorm/
Sleep 800ms
Hide
Wait+Screen@300s /Installed noorm/
Show
Sleep 3s

Type "noorm identity init --name 'Ada Lovelace' --email 'ada@example.com'" Sleep 500ms Enter
Wait+Screen@60s /Fingerprint/
Sleep 4s

Type "noorm init" Sleep 500ms Enter
Sleep 6s

Type "clear" Enter
Sleep 500ms
Type "noorm info" Sleep 500ms Enter
Sleep 2s

# Hold the final screen. PlaybackSpeed 2 halves playback, so this 12s of
# tape reads as ~6s in the GIF — long enough to take in the last frame
# before the loop restarts.
Sleep 12s
