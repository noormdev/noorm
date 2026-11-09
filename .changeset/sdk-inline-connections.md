---
'@noormdev/sdk': minor
---

Allow non-persisted per-context connection overrides without a stored config. Inline connections ignore the active stored config unless a stored base is selected through `config` or `NOORM_CONFIG`, preventing inherited access roles and test clearance.
