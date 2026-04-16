---
"@noormdev/cli": minor
---

Add two new CLI commands:

- `noorm init` — interactive project bootstrap. Creates identity (if missing), project structure, and settings. Requires an interactive TTY.
- `noorm sql repl` — launches the TUI directly on the SQL Terminal screen. Supports `--config <name>` to switch active config before launching. Requires an interactive TTY.
