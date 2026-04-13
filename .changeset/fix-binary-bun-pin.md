---
"@noormdev/cli": patch
---

## Fixed
* `fix(ci):` Pin bun to 1.3.11 in release binary workflow — bun 1.3.12 produces binaries that crash on startup (OOM kill, exit 137)
