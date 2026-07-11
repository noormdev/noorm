---
"@noormdev/cli": patch
---

`feat(update):` the binary self-update now resumes instead of restarting. When a download stalls or the connection drops, `noorm update` retries (up to 5 attempts with backoff) and resumes from the bytes already on disk via an HTTP range request — validated with `If-Range`/`ETag` so a changed asset restarts cleanly rather than stitching a stale prefix. A flaky connection now retries the tail, not the whole ~70MB. Permanent failures (e.g. `404`) still fail fast without retrying, and the CLI prints a `resuming (attempt N/M)` notice between attempts.
