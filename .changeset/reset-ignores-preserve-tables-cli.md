---
"@noormdev/cli": patch
---

fix(cli): noorm db reset rebuilds cleanly regardless of preserveTables

`noorm db reset` (teardown + build) honored `settings.teardown.preserveTables`
during the teardown phase, so preserved tables (e.g. reference vocabulary kept
for the `noorm db truncate` workflow) survived and then collided with the
build's `CREATE TABLE`, aborting the rebuild and leaving a partial schema.
`noorm db reset` now performs a full teardown that ignores `preserveTables` —
a full rebuild starts from nothing. `noorm db teardown` and `noorm db truncate`
still honor the setting.
