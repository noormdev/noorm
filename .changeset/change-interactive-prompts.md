---
"@noormdev/cli": minor
---

Rework `noorm change` for interactive-first ergonomics and drop the surprising bare-invocation side effect.

- Bare `noorm change` now renders citty's help output and **does not connect to the database**. The status listing that used to live there moved to a new explicit leaf: `noorm change list`. This matches every other root command (`config`, `settings`, `identity`, `db`, `vault`, `secret`, `run`) and prevents accidental connection attempts when users are just exploring the CLI.
- `change list` — new. Lists every known change with its status; accepts `--config`, `--json`.
- `change edit [name]` — new. Resolves the change folder from settings and spawns `$EDITOR` (then `$VISUAL`, then `code`) with stdio inherited so terminal editors work in-place; exits with the editor's own exit code. Surfaces spawn failures (e.g. editor binary not found) instead of silently no-oping.
- `change add [description]` — prompts for a description via `p.text` when omitted on a TTY.
- `change rm [name]` — prompts for a change to delete, then confirms with `p.confirm`. `--yes` is no longer required on a TTY (it now just skips the confirm). On a non-TTY, both the name and `--yes` are still required so CI never deletes silently.
- `change run [name]` — prompts from pending/reverted changes (filters `ctx.noorm.changes.status()` by `!orphaned && status in { pending, reverted }`).
- `change revert [name]` — prompts from successfully applied changes.
- `change rewind [name]` — prompts from successfully applied changes.
- `change history-detail [name]` — prompts from changes with execution history (`status !== 'pending'`).

In every case, non-TTY invocations without a name exit 1 with a uniform `Change name required…` error. User cancellation from any picker exits 1 with `Cancelled.`.

**Migration:** replace `noorm change` with `noorm change list` in any scripts or CI jobs that relied on the status listing. The `--json` shape is unchanged.
