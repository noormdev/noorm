---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

Configs with `isTest: true` allow the database lifecycle operations (`db create`, `truncate`, `teardown`, `drop`) for every role on both channels, without confirmation, so test harnesses launched from an agent session can drop and recreate their own database. `db reset` still needs `--yes` and `run:build`. `noorm ci init --test` is now refused on the agent channel. Where the flag counts is in [access roles](https://noorm.dev/guide/environments/configs#access-roles).
