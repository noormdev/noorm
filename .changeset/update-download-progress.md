---
'@noormdev/cli': minor
---

Show download progress while the TUI installs an update

The updater has always emitted byte counts every 512KB, and the CLI has always
rendered them, but the TUI's update screen ignored them: a ~70MB binary
download sat behind a bare spinner for its whole duration, indistinguishable
from a hang. The installing state now shows received and total megabytes, a
percent, and a progress bar, falling back to megabytes alone when the server
sends no `Content-Length`. A stalled attempt that resumes says so, and keeps
the progress it had, because the retry resumes from the bytes already on disk.
