---
'@noormdev/cli': patch
---

Stop the `noorm` binary from loading `.env` in the working directory. Bun's loader expanded `$` and cut values at `#`, so a `NOORM_CONNECTION_PASSWORD` containing those characters reached the database as a different password and login failed. `NOORM_*` variables now come only from the process environment: export them in the shell or set them in CI.
