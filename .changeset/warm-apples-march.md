---
"@noormdev/cli": patch
---

## Fixed

* `fix(change):` Resolve change paths using `projectRoot` instead of bare relative paths, matching the SDK pattern
* `fix(form):` Add Shift+Tab support for backward field navigation
* `fix(config):` Guard ConfigImportScreen `useInput` handler with `isActive` to prevent focus interference
* `fix(config):` Constrain ConfigEditScreen form height to terminal bounds with `overflowY="hidden"`
* `fix(transfer):` Update aggregate `rowsTransferred` in real-time during dt:import and db-to-db transfers
* `fix(transfer):` Prevent `dt:import:complete` from setting phase to `complete` prematurely during multi-file imports
* `fix(transfer):` Show spinner instead of misleading 0% progress bar for same-server transfers
