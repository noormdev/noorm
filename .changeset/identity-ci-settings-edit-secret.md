---
"@noormdev/cli": minor
---

Add CI identity bootstrap and two interactive settings editors:

- `noorm identity ci` — diagnostic command for CI environments. Bootstraps the process from `NOORM_IDENTITY_PRIVATE_KEY`, `NOORM_IDENTITY_NAME`, and `NOORM_IDENTITY_EMAIL` env vars, deriving the public key from the private key and computing a deterministic identity hash across runners. In-memory overrides for both private key and metadata replace `~/.noorm/` filesystem reads, so CI runners can decrypt vault/state without writing key files.
- `noorm settings edit` — interactive editor covering all 7 settings sections: paths, build, strict, logging, stages, rules, teardown. Stages and rules use add/edit/remove sub-loops. Esc inside a sub-editor returns to the section picker; only Esc at the top level exits. Adds `setTeardown()` to `SettingsManager` and a `settings:teardown-updated` event.
- `noorm settings secret` — interactive editor for universal and stage-scoped secret **requirements** (declarations, not values). Supports add, edit, remove, and list actions.
