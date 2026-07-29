---
'@noormdev/cli': patch
'@noormdev/sdk': patch
---

Fix change apply/revert recovery, rewind flag handling, and MySQL support

- Changes now run on MySQL at all. `ChangeHistory` retrieved insert ids with a `RETURNING` clause MySQL does not support, so no operation record was ever created and `change run`, `change ff`, `change revert` and `db teardown` were all inoperable.
- A reverted or torn-down change can be applied again. Every file was previously skipped against a prior success, so `apply -> revert -> apply` and `db teardown -> change ff` reported success over an untouched database.
- `ff` and `next` now treat `stale` changes as pending work, so teardown has a supported recovery path.
- `change rewind` honours `--dry-run` and `--force`, and accepts the documented count form (`change rewind 3`). `changes.rewind()` takes an options argument.
- A revert whose history cannot be read fails instead of reporting success over zero files.
- `.sql.tmpl` files inside a change now receive `$.config` and `$.secrets`.
- `.txt` manifests execute in the order they list files, instead of being sorted.
- `ff`/`next` warn when the changes directory is missing rather than reporting a clean run.
- `change list` marks orphaned changes and no longer lists the internal `__reset__` teardown marker.
