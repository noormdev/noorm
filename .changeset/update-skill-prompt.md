---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

After a successful update on a terminal, `noorm update` asks whether to install or update the noorm agent skill, and runs `npx skills add noormdev/noorm/skills` on yes. A failed or declined install does not change the exit code. `--json` and piped output skip the prompt, and piped text output prints the command instead.
