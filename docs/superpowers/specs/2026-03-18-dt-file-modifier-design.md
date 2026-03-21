# DT File Modifier


## Problem

Exported `.dt` files sometimes cannot be imported because their column shape does not match the target database table. Extra columns need dropping, missing columns need adding, or columns have been renamed. Currently the only option is to re-export from the source database, which may not be available.


## Solution

A DT file modifier that reads a `.dt`/`.dtz`/`.dtzx` file, applies a recipe of column and row transformations, and writes the result to a new file (or overwrites the original). Accessible as a third option alongside export/import in the transfer destination picker.


## Operations (v1)

- **Drop column** — remove a column and its values from every row
- **Add column** — append a column with a universal type and a default value (literal or expression)
- **Rename column** — change a column's name in the header (values unchanged)
- **Filter rows** — keep only rows where a user-supplied JS predicate returns true


## Architecture


### Core Module: `src/core/dt/modify.ts`

#### Recipe Types

```typescript
type DropColumn = { op: 'drop'; column: string }
type AddColumn = { op: 'add'; column: string; type: UniversalType; default: DefaultValue }
type RenameColumn = { op: 'rename'; from: string; to: string }
type FilterRows = { op: 'filter'; predicate: string }

type Modification = DropColumn | AddColumn | RenameColumn | FilterRows
type Recipe = Modification[]

type LiteralDefault = { kind: 'literal'; value: unknown }
type ExpressionDefault = { kind: 'expression'; fn: 'NOW' | 'UUID' }
type DefaultValue = LiteralDefault | ExpressionDefault
```

#### Streaming Pipeline: `modifyDtFile(inputPath, outputPath, recipe, passphrase?)`

Uses the global `observer` singleton from `src/core/observer.ts` for event emission (same pattern as `exportTable` and `importDtFile`).

1. Open reader — `new DtReader({ filepath: inputPath, passphrase })` then `await reader.open()` to parse the schema header
2. Transform schema — apply column operations (drop/add/rename) incrementally to produce a new `DtSchema`. Schema metadata (`d`, `dv`, `t`) is preserved from the input file.
3. Compile filter — if recipe has filter ops, wrap the user's expression with `return` and compile once via `new Function('row', 'return ' + predicate)`. This means users write expressions (`row.age > 18`) not statements.
4. Build column index map — maps old column positions to new positions (handles drops, additions, renames)
5. Open writer — `new DtWriter({ filepath: outputPath, schema: transformedSchema })` (preserves original extension/format)
6. Stream rows — for each row from reader:
    - Build a row proxy with both named (`row.username`) and positional (`row[0]`) access using post-transform column names
    - Run filter predicates — skip row if any returns `false`
    - Remap values: drop removed indices, append default values for added columns, reorder for renames
    - Write transformed row
7. Emit progress events (see Observer Events section below)
8. Close and return result tuple

Returns `[ModifyResult, null]` or `[null, error]` per codebase convention.

```typescript
interface ModifyResult {
    rowsRead: number;
    rowsWritten: number;
    rowsFiltered: number;
    columnsDropped: number;
    columnsAdded: number;
    columnsRenamed: number;
    outputPath: string;
    durationMs: number;
}
```

#### Schema Transformation Order

Operations apply incrementally — each operation sees the schema as modified by all prior operations:

```
Original:  [id, username, email, created_at, updated_at]
  rename(username → user_name):  [id, user_name, email, created_at, updated_at]
  drop(updated_at):              [id, user_name, email, created_at]
  add(role, string, 'user'):     [id, user_name, email, created_at, role]
```

#### Observer Events

Added to `src/core/dt/events.ts` following the existing `dt:export:*` / `dt:import:*` pattern:

```typescript
'dt:modify:start': { inputPath: string; outputPath: string; recipeLength: number }
'dt:modify:progress': { rowsRead: number; rowsWritten: number; rowsFiltered: number }
'dt:modify:complete': { result: ModifyResult }
```

#### Default Value Resolution

- `{ kind: 'literal', value: 'user' }` — same value for every row
- `{ kind: 'expression', fn: 'NOW' }` — `new Date().toISOString()` computed once at start
- `{ kind: 'expression', fn: 'UUID' }` — `crypto.randomUUID()` computed per row

#### Row Proxy

The filter predicate receives a `row` argument that is a `Proxy` supporting both named and positional access:

```javascript
row.username    // named access via post-transform column names
row[0]          // positional access via column index
```

Built once per row from the post-transform column list and the remapped values array.

#### Validation (before streaming)

- Drop: column must exist in current schema (after prior recipe ops)
- Add: column name must not already exist
- Rename: source column must exist, target name must not
- Filter: `new Function('row', 'return ' + predicate)` compilation succeeds + test run against first sample row

Note: `new Function` is intentionally used for filter predicates. This is equivalent to `eval` but acceptable here — the user already has shell access via the CLI, so arbitrary JS execution adds no privilege escalation.


### TUI Screen: `src/cli/screens/db/DtModifyScreen.tsx`

Route: `db/dt-modify`

#### Phases

| Phase | Description |
|-------|-------------|
| `select-file` | FilePicker for `.dt`/`.dtz`/`.dtzx` files |
| `passphrase` | Passphrase input (only for `.dtzx` files) |
| `show-columns` | Column summary table (name, type, nullable, source type) + row count |
| `operations` | Menu loop: [d] drop, [a] add, [r] rename, [f] filter, [v] view schema, [u] undo, [Enter] done, [Esc] cancel |
| `op-drop` | Select column from list to drop |
| `op-add` | Form: name, type (cycle with arrows), nullable, default value |
| `op-rename` | Select column from list, then type new name |
| `op-filter` | Text input for JS predicate, test against first row, show result |
| `output` | Output path input + overwrite toggle (default: new file) |
| `confirm` | Recipe summary + confirm |
| `running` | Progress indicator during streaming |
| `complete` | Result summary (rows read/written/filtered, column changes) |
| `error` | Error display |

#### Operations Menu Behavior

- Shows running recipe summary (numbered list of queued operations)
- [v] "View current schema" shows columns as they would look after all queued operations
- [u] "Undo" removes the last operation from the recipe
- Column lists in drop/rename sub-screens reflect the current schema (after prior recipe ops)

#### Entry Point

Added as a third option in `DbTransferScreen`'s `select-dest` phase:
- "Export to .dt file"
- "Import from .dt file"
- **"Modify .dt file"** — navigates to `db/dt-modify`

Unlike export/import which set `transferMode` and continue through inline phases, modify navigates to a separate route because it does not require a database connection, source config, or table selection. The `handleDestSelect` callback adds:

```typescript
if (item.value === '__modify__') {
    navigate('db/dt-modify');
    return;
}
```

#### Type Selection for Add Column

The `op-add` phase cycles through simple types only: `string`, `int`, `bigint`, `float`, `decimal`, `bool`, `timestamp`, `date`, `uuid`. Encoded types (`json`, `binary`, `vector`, `array`, `text`, `custom`) are excluded because they require encoding tuples that are impractical to enter as default values.

#### Passphrase Handling for Encrypted Files

- Reading `.dtzx` requires a passphrase (collected in the `passphrase` phase)
- If the output path is also `.dtzx`, the same passphrase is reused for writing
- If the user changes the output extension (e.g., `.dtzx` → `.dt`), no encryption is applied to the output
- The `output` phase does not collect a separate passphrase — the read passphrase is the write passphrase


### File Changes

New files:
- `src/core/dt/modify.ts` — recipe types, `modifyDtFile()`, row proxy, filter compiler, schema transformer
- `src/cli/screens/db/DtModifyScreen.tsx` — TUI screen with phase state machine
- `tests/core/dt/modify.test.ts` — core module tests

Modified files:
- `src/core/dt/index.ts` — re-export `modifyDtFile` and recipe types
- `src/core/dt/events.ts` — add `dt:modify:start`, `dt:modify:progress`, `dt:modify:complete` events
- `src/cli/screens/db/DbTransferScreen.tsx` — add "Modify .dt file" option to `select-dest` items
- `src/cli/screens/db/index.ts` — export `DtModifyScreen`
- `src/cli/screens.tsx` — register `db/dt-modify` route
- `src/cli/types.ts` — add `'db/dt-modify'` to Route union

#### Encrypted File Handling

- `.dtzx` input requires passphrase (collected in `passphrase` phase)
- Output preserves the original format unless the user changes the output path extension


## Testing

Core module tests in `tests/core/dt/modify.test.ts`:

- Schema transformation — header output after drop/add/rename combinations
- Row remapping — values correctly reindexed after column operations
- Filter predicate — rows kept/dropped based on JS predicate, both named and positional access
- Default values — literals same every row, `NOW()` valid timestamp, `UUID()` unique per row
- Validation — drop nonexistent column errors, add duplicate errors, rename conflicts
- Recipe ordering — operations apply in sequence (rename then drop the renamed column works)
- Roundtrip — modify a `.dt` file, read output back, verify schema + rows

Tests use real `.dt` files written to `tmp/` per project convention.
