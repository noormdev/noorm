---
"@noormdev/cli": patch
---

## Fixed
* `fix(shutdown):` Force `process.exit()` after graceful shutdown to prevent process hanging from lingering connection pool handles
* `fix(shutdown):` Remove duplicate `app:exit` emission that caused `unmount()` to fire twice
* `fix(shutdown):` Clear timeout timer in connection close race to prevent 5-second event loop leak
