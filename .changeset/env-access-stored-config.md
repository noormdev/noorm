---
"@noormdev/sdk": patch
"@noormdev/cli": patch
---

`NOORM_ACCESS_USER` and `NOORM_ACCESS_AGENT` no longer change the access roles of a stored config. Before, `NOORM_ACCESS_USER=admin` replaced a stored restricted role, and `NOORM_ACCESS_AGENT` could turn a stored `agent: false` into a role, up to the stage's ceiling.

- Behavior change: with a stored config selected, both variables are ignored, including a value that would narrow the role. Narrow a stored config in the config itself.
- A config built from the environment alone (`NOORM_CONNECTION_*`, `config: false`) still takes its access roles from them.
