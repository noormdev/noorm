---
"@noormdev/cli": patch
"@noormdev/sdk": patch
---

The TUI import preview shows the user and agent roles the import saves, and a `Test database` line when the file sets `isTest`, which gives every role at least admin's permissions on that config. The preview fits an 80x24 terminal with every TLS field set. The TUI export and delete screens judge a config by its effective roles, stage defaults included, as activation does.
