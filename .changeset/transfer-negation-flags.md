---
"@noormdev/cli": patch
---

## Fixed
* `fix(db):` `db transfer --no-fk` and `--no-identity` are honoured instead of being silently ignored — citty strips the `--no-` prefix and negates a flag of the remaining name, so the `noFk`/`noIdentity` args they were declared as could never receive a value
