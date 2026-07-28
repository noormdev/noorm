---
id: db-transfer-no-fk-negation-collision
title: citty --no-fk/--no-identity never actually toggle (negation collision)
created: "2026-07-13"
origin: |
    docs/spec/v1-24-polish-batch.md, iter 1 implementer+reviewer (CP-3)
kind: finding
severity: risk
review_by: "2026-09-11"
status: open
file: src/cli/db/transfer.ts:305-306
---

citty's raw-arg parser unconditionally strips any --no-X argv token and treats
it as negating a flag literally named X, regardless of what is declared. Two of
`db transfer`'s boolean flags are themselves named no-fk/no-identity (now noFk/noIdentity),
so passing --no-fk on the CLI has never set args.noFk to true -- it silently sets an
unrelated, undeclared args.fk = false instead. disableForeignKeys: args.noFk !== true
therefore always evaluates true regardless of the flag. Confirmed empirically both
before and after the v1-24 camelCase rename -- behavior is byte-identical, so that
ticket's "flag surface must not change" bar was met, but the flags have likely never
worked as documented. Needs a dedicated fix: likely renaming away from the no- prefix
pattern (e.g. --skip-fk-check/--skip-identity) or adding explicit non-auto-negated
boolean parsing.
