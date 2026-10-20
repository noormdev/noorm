---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

After a successful update, `noorm update` offers the noorm agent skill. It runs `npx skills add noormdev/noorm/skills` when `npx` is on `PATH`, else `gh skill install noormdev/noorm skills/noorm` (GitHub CLI 2.90 or newer). With neither, or when the command fails, it prints both commands and where to get Node.js and the GitHub CLI. On a terminal it asks first; piped output prints the command instead, and `--json` skips the offer. A declined or failed skill install does not change the exit code.

On a terminal, `noorm update` now rewrites its status line in place: `Checking for updates...` is replaced by the result, and the download counter ends on `Downloaded X MB (100%)`. `noorm update --json` now writes only the JSON document to stdout; before, status lines preceded it.
