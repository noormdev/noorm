---
"@noormdev/cli": patch
---

`fix(update):` the binary self-update no longer hangs indefinitely and now shows download progress. `noorm update` streamed the ~70MB release binary with a bare `fetch()` — no timeout, so a stalled connection hung forever with no error and no feedback, indistinguishable from a freeze. It now streams to disk with a live `Downloading X / Y MB (Z%)` readout, aborts with a clear error if the transfer stalls (no bytes for 30s), and stages the replacement in the target's own directory so the atomic swap can't fail with a cross-filesystem `EXDEV` (e.g. `os.tmpdir()` on a different volume than `~/.local/bin`).
