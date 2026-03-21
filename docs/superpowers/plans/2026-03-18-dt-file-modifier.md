# DT File Modifier Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DT file modifier that drops/adds/renames columns and filters rows via a recipe pattern, accessible from the transfer screen.

**Architecture:** Core `modify.ts` module defines recipe types and a streaming `modifyDtFile()` function that reads a DT file, transforms the schema/rows per recipe operations, and writes to a new file. TUI `DtModifyScreen` provides the interactive phase-based workflow. Entry point is a third option in the transfer destination picker.

**Tech Stack:** DtReader/DtWriter for streaming I/O, `new Function` for JS filter predicates, Proxy for dual named+positional row access, `bun:test` for testing.

**Spec:** `docs/superpowers/specs/2026-03-18-dt-file-modifier-design.md`

---

### Task 1: Add `dt:modify:*` events to DtEvents

**Files:**
- Modify: `src/core/dt/events.ts:121` (before closing brace)

- [ ] **Step 1: Add the three modify event types**

In `src/core/dt/events.ts`, add before the closing `}` of the `DtEvents` interface:

```typescript

    // --- Modify pipeline ---

    /** Modify operation begins. */
    'dt:modify:start': {
        inputPath: string;
        outputPath: string;
        recipeLength: number;
    };

    /** After each row processed during modify. */
    'dt:modify:progress': {
        rowsRead: number;
        rowsWritten: number;
        rowsFiltered: number;
    };

    /** Modify operation finished. */
    'dt:modify:complete': {
        result: {
            rowsRead: number;
            rowsWritten: number;
            rowsFiltered: number;
            columnsDropped: number;
            columnsAdded: number;
            columnsRenamed: number;
            outputPath: string;
            durationMs: number;
        };
    };
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors related to DtEvents

- [ ] **Step 3: Commit**

```bash
git add src/core/dt/events.ts
git commit -m "feat(dt): add modify event types to DtEvents"
```

---

### Task 2: Core modify module — recipe types and schema transformer

**Files:**
- Create: `src/core/dt/modify.ts`
- Test: `tests/core/dt/modify.test.ts`

This task builds the recipe type definitions, the `transformSchema()` function, and the `validateRecipe()` function. No streaming yet — just schema manipulation.

- [ ] **Step 1: Write failing tests for schema transformation and validation**

Create `tests/core/dt/modify.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import type { DtSchema } from '../../../src/core/dt/types.js';

// Will import from modify.ts once created
import {
    transformSchema,
    validateRecipe,
    type Recipe,
} from '../../../src/core/dt/modify.js';

const TMP_DIR = path.join(process.cwd(), 'tmp');

describe('dt: modify', () => {

    let testDir: string;

    const schema: DtSchema = {
        v: 1,
        d: 'postgresql',
        dv: '17.7',
        t: 'users',
        columns: [
            { name: 'id', type: 'int', nullable: false },
            { name: 'username', type: 'string' },
            { name: 'email', type: 'string' },
            { name: 'created_at', type: 'timestamp' },
            { name: 'updated_at', type: 'timestamp' },
        ],
    };

    beforeEach(() => {

        const hex = randomBytes(4).toString('hex');
        testDir = path.join(TMP_DIR, `test-modify-${hex}`);
        mkdirSync(testDir, { recursive: true });

    });

    afterEach(() => {

        if (existsSync(testDir)) {

            rmSync(testDir, { recursive: true, force: true });

        }

    });

    describe('transformSchema', () => {

        it('should drop a column', () => {

            const recipe: Recipe = [{ op: 'drop', column: 'updated_at' }];
            const result = transformSchema(schema, recipe);

            expect(result.columns).toHaveLength(4);
            expect(result.columns.find(c => c.name === 'updated_at')).toBeUndefined();

        });

        it('should add a column', () => {

            const recipe: Recipe = [{
                op: 'add',
                column: 'role',
                type: 'string',
                default: { kind: 'literal', value: 'user' },
            }];
            const result = transformSchema(schema, recipe);

            expect(result.columns).toHaveLength(6);
            expect(result.columns[5]!.name).toBe('role');
            expect(result.columns[5]!.type).toBe('string');

        });

        it('should rename a column', () => {

            const recipe: Recipe = [{ op: 'rename', from: 'username', to: 'user_name' }];
            const result = transformSchema(schema, recipe);

            expect(result.columns[1]!.name).toBe('user_name');
            expect(result.columns).toHaveLength(5);

        });

        it('should apply operations incrementally', () => {

            const recipe: Recipe = [
                { op: 'rename', from: 'username', to: 'user_name' },
                { op: 'drop', column: 'updated_at' },
                { op: 'add', column: 'role', type: 'string', default: { kind: 'literal', value: 'user' } },
            ];
            const result = transformSchema(schema, recipe);

            const names = result.columns.map(c => c.name);
            expect(names).toEqual(['id', 'user_name', 'email', 'created_at', 'role']);

        });

        it('should preserve schema metadata (v, d, dv, t)', () => {

            const recipe: Recipe = [{ op: 'drop', column: 'email' }];
            const result = transformSchema(schema, recipe);

            expect(result.v).toBe(1);
            expect(result.d).toBe('postgresql');
            expect(result.dv).toBe('17.7');
            expect(result.t).toBe('users');

        });

        it('should ignore filter ops (no schema effect)', () => {

            const recipe: Recipe = [{ op: 'filter', predicate: 'row.id > 2' }];
            const result = transformSchema(schema, recipe);

            expect(result.columns).toHaveLength(5);

        });

    });

    describe('validateRecipe', () => {

        it('should reject dropping a nonexistent column', () => {

            const recipe: Recipe = [{ op: 'drop', column: 'nonexistent' }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();
            expect(err!.message).toContain('nonexistent');

        });

        it('should reject adding a duplicate column', () => {

            const recipe: Recipe = [{
                op: 'add',
                column: 'email',
                type: 'string',
                default: { kind: 'literal', value: '' },
            }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();
            expect(err!.message).toContain('email');

        });

        it('should reject renaming from nonexistent column', () => {

            const recipe: Recipe = [{ op: 'rename', from: 'nope', to: 'yep' }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();

        });

        it('should reject renaming to an existing column name', () => {

            const recipe: Recipe = [{ op: 'rename', from: 'username', to: 'email' }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();

        });

        it('should validate incrementally (rename then drop renamed)', () => {

            const recipe: Recipe = [
                { op: 'rename', from: 'username', to: 'user_name' },
                { op: 'drop', column: 'user_name' },
            ];
            const [result, err] = validateRecipe(schema, recipe);

            expect(err).toBeNull();
            expect(result).toBeTruthy();

        });

        it('should reject invalid filter predicate syntax', () => {

            const recipe: Recipe = [{ op: 'filter', predicate: 'row.id >>' }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();

        });

        it('should accept valid filter predicate', () => {

            const recipe: Recipe = [{ op: 'filter', predicate: 'row.id > 2' }];
            const [result, err] = validateRecipe(schema, recipe);

            expect(err).toBeNull();
            expect(result).toBeTruthy();

        });

    });

});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/dt/modify.test.ts`
Expected: FAIL — cannot resolve `../../../src/core/dt/modify.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/dt/modify.ts`:

```typescript
/**
 * DT file modifier — recipe-based schema and row transformation.
 *
 * Applies a sequence of operations (drop, add, rename columns; filter rows)
 * to a .dt file, streaming rows through the pipeline. Used when an exported
 * .dt file's shape doesn't match the target database.
 *
 * @example
 * ```typescript
 * import { modifyDtFile, type Recipe } from './modify.js';
 *
 * const recipe: Recipe = [
 *     { op: 'drop', column: 'updated_at' },
 *     { op: 'add', column: 'role', type: 'string', default: { kind: 'literal', value: 'user' } },
 *     { op: 'filter', predicate: 'row.id > 2' },
 * ];
 *
 * const [result, err] = await modifyDtFile({
 *     inputPath: './export/users.dt',
 *     outputPath: './export/users_modified.dt',
 *     recipe,
 * });
 * ```
 */
import { randomUUID } from 'node:crypto';

import { attempt, attemptSync } from '@logosdx/utils';

import type { DtColumn, DtSchema, DtValue, UniversalType } from './types.js';

// ---------------------------------------------------------------------------
// Recipe types
// ---------------------------------------------------------------------------

export type LiteralDefault = { kind: 'literal'; value: unknown };
export type ExpressionDefault = { kind: 'expression'; fn: 'NOW' | 'UUID' };
export type DefaultValue = LiteralDefault | ExpressionDefault;

export type DropColumn = { op: 'drop'; column: string };
export type AddColumn = { op: 'add'; column: string; type: UniversalType; default: DefaultValue };
export type RenameColumn = { op: 'rename'; from: string; to: string };
export type FilterRows = { op: 'filter'; predicate: string };

export type Modification = DropColumn | AddColumn | RenameColumn | FilterRows;
export type Recipe = Modification[];

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ModifyResult {

    rowsRead: number;
    rowsWritten: number;
    rowsFiltered: number;
    columnsDropped: number;
    columnsAdded: number;
    columnsRenamed: number;
    outputPath: string;
    durationMs: number;

}

// ---------------------------------------------------------------------------
// Schema transformation
// ---------------------------------------------------------------------------

/**
 * Applies recipe column operations to a schema, producing a new schema.
 *
 * Operations apply incrementally — each sees the result of prior operations.
 * Filter operations have no effect on the schema.
 */
export function transformSchema(schema: DtSchema, recipe: Recipe): DtSchema {

    let columns = schema.columns.map(c => ({ ...c }));

    for (const mod of recipe) {

        if (mod.op === 'drop') {

            columns = columns.filter(c => c.name !== mod.column);

        }
        else if (mod.op === 'add') {

            columns.push({
                name: mod.column,
                type: mod.type,
                nullable: true,
            });

        }
        else if (mod.op === 'rename') {

            const col = columns.find(c => c.name === mod.from);

            if (col) {

                col.name = mod.to;

            }

        }
        // 'filter' — no schema effect

    }

    return {
        v: schema.v,
        d: schema.d,
        dv: schema.dv,
        t: schema.t,
        columns,
    };

}

// ---------------------------------------------------------------------------
// Recipe validation
// ---------------------------------------------------------------------------

/**
 * Validates a recipe against a schema, checking each operation incrementally.
 *
 * Returns [true, null] on success or [null, Error] with a descriptive message.
 */
export function validateRecipe(
    schema: DtSchema,
    recipe: Recipe,
): [true, null] | [null, Error] {

    let columns = schema.columns.map(c => ({ ...c }));

    for (const mod of recipe) {

        if (mod.op === 'drop') {

            const exists = columns.some(c => c.name === mod.column);

            if (!exists) {

                return [null, new Error(`Cannot drop column "${mod.column}" — does not exist`)];

            }

            columns = columns.filter(c => c.name !== mod.column);

        }
        else if (mod.op === 'add') {

            const exists = columns.some(c => c.name === mod.column);

            if (exists) {

                return [null, new Error(`Cannot add column "${mod.column}" — already exists`)];

            }

            columns.push({ name: mod.column, type: mod.type, nullable: true });

        }
        else if (mod.op === 'rename') {

            const exists = columns.some(c => c.name === mod.from);

            if (!exists) {

                return [null, new Error(`Cannot rename column "${mod.from}" — does not exist`)];

            }

            const targetExists = columns.some(c => c.name === mod.to);

            if (targetExists) {

                return [null, new Error(`Cannot rename to "${mod.to}" — column already exists`)];

            }

            const col = columns.find(c => c.name === mod.from)!;
            col.name = mod.to;

        }
        else if (mod.op === 'filter') {

            const [, compileErr] = attemptSync(() => new Function('row', 'return ' + mod.predicate));

            if (compileErr) {

                return [null, new Error(`Invalid filter predicate: ${compileErr.message}`)];

            }

        }

    }

    return [true, null];

}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/dt/modify.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/dt/modify.ts tests/core/dt/modify.test.ts
git commit -m "feat(dt): add recipe types, schema transformer, and validation"
```

---

### Task 3: Core modify module — row remapping and `modifyDtFile()`

**Files:**
- Modify: `src/core/dt/modify.ts`
- Modify: `tests/core/dt/modify.test.ts`

This task adds `buildRowProxy()`, `buildColumnMap()`, default value resolution, and the main `modifyDtFile()` streaming function.

- [ ] **Step 1: Write failing tests for row proxy**

Add to `tests/core/dt/modify.test.ts`:

```typescript
import { buildRowProxy } from '../../../src/core/dt/modify.js';

describe('buildRowProxy', () => {

    const columns = [
        { name: 'id', type: 'int' as const },
        { name: 'username', type: 'string' as const },
        { name: 'email', type: 'string' as const },
    ];

    it('should support named access', () => {

        const proxy = buildRowProxy(columns, [1, 'alice', 'alice@test.com']);

        expect(proxy.id).toBe(1);
        expect(proxy.username).toBe('alice');
        expect(proxy.email).toBe('alice@test.com');

    });

    it('should support positional access', () => {

        const proxy = buildRowProxy(columns, [1, 'alice', 'alice@test.com']);

        expect(proxy[0]).toBe(1);
        expect(proxy[1]).toBe('alice');
        expect(proxy[2]).toBe('alice@test.com');

    });

    it('should return undefined for nonexistent properties', () => {

        const proxy = buildRowProxy(columns, [1, 'alice', 'alice@test.com']);

        expect(proxy.nonexistent).toBeUndefined();
        expect(proxy[99]).toBeUndefined();

    });

});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/dt/modify.test.ts`
Expected: FAIL — `buildRowProxy` not exported

- [ ] **Step 3: Implement `buildRowProxy` in `src/core/dt/modify.ts`**

Add to `src/core/dt/modify.ts`:

```typescript
// ---------------------------------------------------------------------------
// Row proxy
// ---------------------------------------------------------------------------

/**
 * Creates a Proxy for a row that supports both named and positional access.
 *
 * Used by filter predicates so users can write `row.username` or `row[0]`.
 */
export function buildRowProxy(
    columns: Pick<DtColumn, 'name'>[],
    values: DtValue[],
): Record<string, DtValue> & Record<number, DtValue> {

    // Build name-to-index map
    const nameMap: Record<string, number> = {};

    for (let i = 0; i < columns.length; i++) {

        nameMap[columns[i]!.name] = i;

    }

    return new Proxy({} as Record<string, DtValue> & Record<number, DtValue>, {

        get(_target, prop) {

            if (typeof prop === 'symbol') return undefined;

            // Positional: numeric string
            const idx = Number(prop);

            if (!Number.isNaN(idx) && Number.isInteger(idx)) {

                return values[idx];

            }

            // Named: column name
            const colIdx = nameMap[prop];

            if (colIdx !== undefined) {

                return values[colIdx];

            }

            return undefined;

        },

    });

}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/dt/modify.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Write failing tests for `modifyDtFile` roundtrip**

Add to `tests/core/dt/modify.test.ts`:

```typescript
import { DtWriter } from '../../../src/core/dt/writer.js';
import { DtReader } from '../../../src/core/dt/reader.js';
import { modifyDtFile } from '../../../src/core/dt/modify.js';

describe('modifyDtFile', () => {

    async function writeFixture(): Promise<string> {

        const filepath = path.join(testDir, 'source.dt');
        const writer = new DtWriter({ filepath, schema });
        await writer.open();
        writer.writeRow([1, 'alice', 'alice@test.com', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z']);
        writer.writeRow([2, 'bob', 'bob@test.com', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z']);
        writer.writeRow([3, 'carol', 'carol@test.com', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z']);
        await writer.close();
        return filepath;

    }

    it('should drop a column from rows', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [{ op: 'drop', column: 'updated_at' }];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();
        expect(result!.rowsWritten).toBe(3);
        expect(result!.columnsDropped).toBe(1);

        // Verify output
        const reader = new DtReader({ filepath: outputPath });
        await reader.open();
        expect(reader.schema!.columns).toHaveLength(4);
        expect(reader.schema!.columns.find(c => c.name === 'updated_at')).toBeUndefined();

        const rows: DtValue[][] = [];
        for await (const row of reader.rows()) rows.push(row);
        reader.close();

        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveLength(4); // 5 columns minus 1

    });

    it('should add a column with literal default', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [{
            op: 'add',
            column: 'role',
            type: 'string',
            default: { kind: 'literal', value: 'user' },
        }];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();
        expect(result!.columnsAdded).toBe(1);

        const reader = new DtReader({ filepath: outputPath });
        await reader.open();
        expect(reader.schema!.columns).toHaveLength(6);

        const rows: DtValue[][] = [];
        for await (const row of reader.rows()) rows.push(row);
        reader.close();

        // Last value in each row should be 'user'
        for (const row of rows) {

            expect(row[5]).toBe('user');

        }

    });

    it('should add a column with NOW() expression', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [{
            op: 'add',
            column: 'processed_at',
            type: 'timestamp',
            default: { kind: 'expression', fn: 'NOW' },
        }];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();

        const reader = new DtReader({ filepath: outputPath });
        await reader.open();
        const rows: DtValue[][] = [];
        for await (const row of reader.rows()) rows.push(row);
        reader.close();

        // All rows should have the same timestamp (NOW computed once)
        const ts = rows[0]![5] as string;
        expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        for (const row of rows) {

            expect(row[5]).toBe(ts);

        }

    });

    it('should add a column with UUID() expression (unique per row)', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [{
            op: 'add',
            column: 'trace_id',
            type: 'uuid',
            default: { kind: 'expression', fn: 'UUID' },
        }];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();

        const reader = new DtReader({ filepath: outputPath });
        await reader.open();
        const rows: DtValue[][] = [];
        for await (const row of reader.rows()) rows.push(row);
        reader.close();

        const uuids = rows.map(r => r[5] as string);
        expect(new Set(uuids).size).toBe(3); // All unique

    });

    it('should rename a column', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [{ op: 'rename', from: 'username', to: 'user_name' }];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();
        expect(result!.columnsRenamed).toBe(1);

        const reader = new DtReader({ filepath: outputPath });
        await reader.open();
        expect(reader.schema!.columns[1]!.name).toBe('user_name');

        const rows: DtValue[][] = [];
        for await (const row of reader.rows()) rows.push(row);
        reader.close();

        // Values unchanged
        expect(rows[0]![1]).toBe('alice');
        expect(rows).toHaveLength(3);

    });

    it('should filter rows with predicate (named access)', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [{ op: 'filter', predicate: 'row.id > 1' }];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();
        expect(result!.rowsRead).toBe(3);
        expect(result!.rowsWritten).toBe(2);
        expect(result!.rowsFiltered).toBe(1);

    });

    it('should filter rows with predicate (positional access)', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [{ op: 'filter', predicate: 'row[0] > 1' }];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();
        expect(result!.rowsWritten).toBe(2);

    });

    it('should apply multiple operations in sequence', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [
            { op: 'rename', from: 'username', to: 'user_name' },
            { op: 'drop', column: 'updated_at' },
            { op: 'add', column: 'role', type: 'string', default: { kind: 'literal', value: 'admin' } },
            { op: 'filter', predicate: 'row.id <= 2' },
        ];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();
        expect(result!.rowsWritten).toBe(2);
        expect(result!.rowsFiltered).toBe(1);
        expect(result!.columnsDropped).toBe(1);
        expect(result!.columnsAdded).toBe(1);
        expect(result!.columnsRenamed).toBe(1);

        const reader = new DtReader({ filepath: outputPath });
        await reader.open();
        const names = reader.schema!.columns.map(c => c.name);
        expect(names).toEqual(['id', 'user_name', 'email', 'created_at', 'role']);

        const rows: DtValue[][] = [];
        for await (const row of reader.rows()) rows.push(row);
        reader.close();

        expect(rows).toHaveLength(2);
        expect(rows[0]![4]).toBe('admin');

    });

    it('should produce a clean copy with empty recipe', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();
        expect(result!.rowsRead).toBe(3);
        expect(result!.rowsWritten).toBe(3);
        expect(result!.rowsFiltered).toBe(0);

        const reader = new DtReader({ filepath: outputPath });
        await reader.open();
        expect(reader.schema!.columns).toHaveLength(5);

        const rows: DtValue[][] = [];
        for await (const row of reader.rows()) rows.push(row);
        reader.close();

        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveLength(5);

    });

    it('should filter using renamed column name (post-transform access)', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [
            { op: 'rename', from: 'username', to: 'user_name' },
            { op: 'filter', predicate: 'row.user_name === "alice"' },
        ];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(err).toBeNull();
        expect(result!.rowsWritten).toBe(1);
        expect(result!.rowsFiltered).toBe(2);

        const reader = new DtReader({ filepath: outputPath });
        await reader.open();
        expect(reader.schema!.columns[1]!.name).toBe('user_name');

        const rows: DtValue[][] = [];
        for await (const row of reader.rows()) rows.push(row);
        reader.close();

        expect(rows[0]![1]).toBe('alice');

    });

    it('should return error for invalid recipe', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [{ op: 'drop', column: 'nonexistent' }];

        const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

        expect(result).toBeNull();
        expect(err).toBeTruthy();

    });

    it('should preserve schema metadata', async () => {

        const inputPath = await writeFixture();
        const outputPath = path.join(testDir, 'output.dt');
        const recipe: Recipe = [{ op: 'drop', column: 'email' }];

        await modifyDtFile({ inputPath, outputPath, recipe });

        const reader = new DtReader({ filepath: outputPath });
        await reader.open();
        expect(reader.schema!.v).toBe(1);
        expect(reader.schema!.d).toBe('postgresql');
        expect(reader.schema!.dv).toBe('17.7');
        expect(reader.schema!.t).toBe('users');
        reader.close();

    });

});
```

- [ ] **Step 6: Run tests to verify new tests fail**

Run: `bun test tests/core/dt/modify.test.ts`
Expected: FAIL — `modifyDtFile` not exported

- [ ] **Step 7: Implement `modifyDtFile` and helpers**

Add to `src/core/dt/modify.ts`. Note: `attempt` is already imported from `@logosdx/utils` (merged in Task 2). Add these new imports after the existing ones:

```typescript
import { observer } from '../observer.js';
import { DtReader } from './reader.js';
import { DtWriter } from './writer.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ModifyOptions {

    /** Input .dt/.dtz/.dtzx file path. */
    inputPath: string;

    /** Output file path. */
    outputPath: string;

    /** Recipe of operations to apply. */
    recipe: Recipe;

    /** Passphrase for .dtzx files (used for both read and write). */
    passphrase?: string;

}

// ---------------------------------------------------------------------------
// Column map
// ---------------------------------------------------------------------------

interface ColumnMap {

    /** Indices to keep from the source row (in order). */
    keepIndices: number[];

    /** Default values to append for added columns. */
    addedDefaults: (() => DtValue)[];

}

/**
 * Builds a column index map from original schema to transformed schema.
 *
 * Processes operations incrementally (matching transformSchema/validateRecipe)
 * to correctly handle complex recipes like [drop(A), add(A), drop(A)].
 */
function buildColumnMap(
    originalColumns: DtColumn[],
    recipe: Recipe,
): ColumnMap {

    // Track live columns as { originalIndex | -1 for added, name }
    let liveColumns: { srcIdx: number; name: string }[] =
        originalColumns.map((c, i) => ({ srcIdx: i, name: c.name }));

    const addedDefaults: (() => DtValue)[] = [];

    for (const mod of recipe) {

        if (mod.op === 'drop') {

            liveColumns = liveColumns.filter(c => c.name !== mod.column);

        }
        else if (mod.op === 'add') {

            liveColumns.push({ srcIdx: -1, name: mod.column });

            if (mod.default.kind === 'literal') {

                const val = mod.default.value;
                addedDefaults.push(() => val);

            }
            else if (mod.default.fn === 'NOW') {

                const now = new Date().toISOString();
                addedDefaults.push(() => now);

            }
            else if (mod.default.fn === 'UUID') {

                addedDefaults.push(() => randomUUID());

            }

        }
        else if (mod.op === 'rename') {

            const col = liveColumns.find(c => c.name === mod.from);

            if (col) {

                col.name = mod.to;

            }

        }
        // 'filter' — no column map effect

    }

    // keepIndices: source row indices for surviving original columns (in order)
    const keepIndices = liveColumns
        .filter(c => c.srcIdx !== -1)
        .map(c => c.srcIdx);

    return { keepIndices, addedDefaults };

}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Modifies a .dt file by applying a recipe of operations.
 *
 * Streams rows from input through the recipe pipeline and writes to output.
 * Validates the recipe against the input schema before processing.
 *
 * @returns Error tuple: [ModifyResult, null] on success, [null, Error] on failure
 */
export async function modifyDtFile(
    options: ModifyOptions,
): Promise<[ModifyResult, null] | [null, Error]> {

    const { inputPath, outputPath, recipe, passphrase } = options;
    const start = Date.now();

    // Open reader
    const reader = new DtReader({ filepath: inputPath, passphrase });
    const [, openErr] = await attempt(() => reader.open());

    if (openErr) {

        return [null, new Error(`Failed to open DT file: ${openErr.message}`)];

    }

    const sourceSchema = reader.schema!;

    // Validate recipe
    const [, validationErr] = validateRecipe(sourceSchema, recipe);

    if (validationErr) {

        reader.close();

        return [null, validationErr];

    }

    // Transform schema
    const transformedSchema = transformSchema(sourceSchema, recipe);

    // Build column map and filter predicates
    const columnMap = buildColumnMap(sourceSchema.columns, recipe);

    const filterFns: ((row: Record<string, DtValue>) => boolean)[] = [];

    for (const mod of recipe) {

        if (mod.op === 'filter') {

            // Safe: validateRecipe already checked syntax; attemptSync for consistency
            const [fn, compileErr] = attemptSync(() =>
                new Function('row', 'return ' + mod.predicate) as (row: Record<string, DtValue>) => boolean,
            );

            if (compileErr) {

                reader.close();

                return [null, new Error(`Filter compilation failed: ${compileErr.message}`)];

            }

            filterFns.push(fn!);

        }

    }

    // Open writer
    const writer = new DtWriter({
        filepath: outputPath,
        schema: transformedSchema,
        passphrase,
    });

    const [, writerErr] = await attempt(() => writer.open());

    if (writerErr) {

        reader.close();

        return [null, new Error(`Failed to open output file: ${writerErr.message}`)];

    }

    // Counters
    let rowsRead = 0;
    let rowsWritten = 0;
    let rowsFiltered = 0;

    const countMods = (op: string) => recipe.filter(m => m.op === op).length;

    // Emit start event
    observer.emit('dt:modify:start', {
        inputPath,
        outputPath,
        recipeLength: recipe.length,
    });

    // Stream rows
    for await (const sourceRow of reader.rows()) {

        rowsRead++;

        // Build remapped row (keep + defaults)
        const remapped: DtValue[] = columnMap.keepIndices.map(i => sourceRow[i]);

        for (const factory of columnMap.addedDefaults) {

            remapped.push(factory());

        }

        // Apply filters using the post-transform column names
        if (filterFns.length > 0) {

            const proxy = buildRowProxy(transformedSchema.columns, remapped);
            let keep = true;

            for (const fn of filterFns) {

                if (!fn(proxy)) {

                    keep = false;
                    break;

                }

            }

            if (!keep) {

                rowsFiltered++;
                continue;

            }

        }

        writer.writeRow(remapped);
        rowsWritten++;

        // Emit progress every 100 rows
        if (rowsRead % 100 === 0) {

            observer.emit('dt:modify:progress', { rowsRead, rowsWritten, rowsFiltered });

        }

    }

    // Close
    reader.close();
    await writer.close();

    const result: ModifyResult = {
        rowsRead,
        rowsWritten,
        rowsFiltered,
        columnsDropped: countMods('drop'),
        columnsAdded: countMods('add'),
        columnsRenamed: countMods('rename'),
        outputPath,
        durationMs: Date.now() - start,
    };

    observer.emit('dt:modify:complete', { result });

    return [result, null];

}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test tests/core/dt/modify.test.ts`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/core/dt/modify.ts tests/core/dt/modify.test.ts
git commit -m "feat(dt): implement modifyDtFile with row proxy and streaming pipeline"
```

---

### Task 4: Re-export modify types and function from dt barrel

**Files:**
- Modify: `src/core/dt/index.ts:1137` (end of file)

- [ ] **Step 1: Add re-exports**

At the end of `src/core/dt/index.ts`, add:

```typescript
export { modifyDtFile, transformSchema, validateRecipe, buildRowProxy } from './modify.js';
export type {
    Recipe,
    Modification,
    DropColumn,
    AddColumn,
    RenameColumn,
    FilterRows,
    DefaultValue,
    LiteralDefault,
    ExpressionDefault,
    ModifyResult,
    ModifyOptions,
} from './modify.js';
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/dt/index.ts
git commit -m "feat(dt): re-export modify types and functions from barrel"
```

---

### Task 5: Register `db/dt-modify` route and add entry point

**Files:**
- Modify: `src/cli/types.ts:46` (Route union, after `'db/transfer'`)
- Modify: `src/cli/screens/db/index.ts:35` (add export)
- Modify: `src/cli/screens.tsx:64` (add import)
- Modify: `src/cli/screens.tsx:270` (add registry entry after `'db/transfer'`)
- Modify: `src/cli/screens/db/DbTransferScreen.tsx:85` (destructure `navigate`)
- Modify: `src/cli/screens/db/DbTransferScreen.tsx:137-150` (add modify item)
- Modify: `src/cli/screens/db/DbTransferScreen.tsx:334` (add handler)

- [ ] **Step 1: Add route to Route union**

In `src/cli/types.ts`, after `| 'db/transfer'` (line 45), add:

```typescript
    | 'db/dt-modify'
```

- [ ] **Step 2: Create placeholder DtModifyScreen**

Create `src/cli/screens/db/DtModifyScreen.tsx`:

```tsx
/**
 * DtModifyScreen — modify .dt file columns and rows via recipe.
 *
 * Provides an interactive workflow to drop, add, rename columns
 * and filter rows from an existing .dt/.dtz/.dtzx file.
 *
 * @example
 * ```bash
 * noorm db transfer → Modify .dt file
 * ```
 */
import { Box, Text } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useInput } from 'ink';
import { Panel } from '../../components/index.js';

/**
 * Placeholder for the DT modify screen.
 *
 * Full implementation in Task 6.
 */
export function DtModifyScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('DtModifyScreen');

    useInput((_input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

        }

    });

    return (
        <Panel title="Modify DT File" paddingX={1} paddingY={1}>
            <Text>DT Modify screen — coming soon</Text>
            <Box marginTop={1}>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Panel>
    );

}
```

- [ ] **Step 3: Export from db/index.ts**

In `src/cli/screens/db/index.ts`, add before the SQL Terminal section:

```typescript
export { DtModifyScreen } from './DtModifyScreen.js';
```

- [ ] **Step 4: Import and register in screens.tsx**

In `src/cli/screens.tsx`, add `DtModifyScreen` to the db imports (around line 64):

```typescript
import {
    DbListScreen,
    DbCreateScreen,
    DbDestroyScreen,
    DbTransferScreen,
    DbTruncateScreen,
    DbTeardownScreen,
    DtModifyScreen,
    ExploreOverviewScreen,
    // ...
```

In the SCREENS registry (after `'db/transfer'` entry, around line 270), add:

```typescript
    'db/dt-modify': {
        component: DtModifyScreen,
        label: 'Modify DT File',
    },
```

- [ ] **Step 5: Add entry point in DbTransferScreen**

In `src/cli/screens/db/DbTransferScreen.tsx`:

1. Line 85: Change `const { back } = useRouter();` to `const { back, navigate } = useRouter();`

2. The existing code uses `items.push(exportItem, importItem)` as a multi-argument call (line 137-150). Add the modify item as a third argument to the same `push()` call, after the import item:

```typescript
            {
                key: '__modify__',
                label: 'Modify .dt file',
                value: '__modify__',
                description: 'Drop, add, or rename columns; filter rows',
            },
```

3. In `handleDestSelect` (line 334), before the `setTransferMode('db-to-db')` fallback, add:

```typescript
        if (item.value === '__modify__') {

            navigate('db/dt-modify');

            return;

        }
```

- [ ] **Step 6: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/cli/types.ts src/cli/screens/db/DtModifyScreen.tsx src/cli/screens/db/index.ts src/cli/screens.tsx src/cli/screens/db/DbTransferScreen.tsx
git commit -m "feat(cli): register db/dt-modify route with entry point in transfer screen"
```

---

### Task 6: Implement DtModifyScreen — file selection and schema display

**Files:**
- Modify: `src/cli/screens/db/DtModifyScreen.tsx`

This task replaces the placeholder with the full phase state machine, implementing the first three phases: `select-file`, `passphrase`, and `show-columns`.

- [ ] **Step 1: Implement file selection, passphrase, and column display phases**

Rewrite `src/cli/screens/db/DtModifyScreen.tsx` with the full component. This is a large file. The phase type is:

```typescript
type Phase =
    | 'select-file'
    | 'passphrase'
    | 'show-columns'
    | 'operations'
    | 'op-drop'
    | 'op-add'
    | 'op-rename'
    | 'op-filter'
    | 'output'
    | 'confirm'
    | 'running'
    | 'complete'
    | 'error';
```

Implement these phases in this task:

**`select-file`** — Use `FilePicker` to scan for `.dt`/`.dtz`/`.dtzx` files. Follow the same scanning pattern from `DbTransferScreen` (`useAsyncEffect` scanning `process.cwd()` recursively for matching extensions). On file selection, check extension — if `.dtzx`, go to `passphrase` phase, otherwise go to `show-columns`.

**`passphrase`** — `TextInput` for passphrase with mask. On submit, proceed to `show-columns`.

**`show-columns`** — Use `useAsyncEffect` to open `DtReader`, read schema and first row (for later filter testing). Display a table of columns (name, type, nullable, sourceType) and row count. On Enter, proceed to `operations`.

State needed:

```typescript
const [phase, setPhase] = useState<Phase>('select-file');
const [error, setError] = useState<string | null>(null);
const [selectedFile, setSelectedFile] = useState<string | null>(null);
const [passphrase, setPassphrase] = useState('');
const [sourceSchema, setSourceSchema] = useState<DtSchema | null>(null);
const [sampleRow, setSampleRow] = useState<DtValue[] | null>(null);
const [rowCount, setRowCount] = useState(0);
const [recipe, setRecipe] = useState<Recipe>([]);
// ... output/running state added in later tasks
```

Use the same `useAsyncEffect` with `isCancelled` guard pattern from `DbTransferScreen`. Use `useFocusScope` for keyboard handling.

Imports needed:

```typescript
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { DtSchema, DtValue } from '../../../core/dt/types.js';
import type { Recipe, Modification } from '../../../core/dt/modify.js';

import { DtReader } from '../../../core/dt/reader.js';
import { transformSchema } from '../../../core/dt/modify.js';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAsyncEffect } from '../../hooks/index.js';
import {
    useToast,
    Panel,
    Spinner,
    SelectList,
    FilePicker,
    Confirm,
    KeyHandler,
    type SelectListItem,
} from '../../components/index.js';
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/screens/db/DtModifyScreen.tsx
git commit -m "feat(cli): implement DtModifyScreen file selection and schema display"
```

---

### Task 7: Implement DtModifyScreen — operations menu and sub-screens

**Files:**
- Modify: `src/cli/screens/db/DtModifyScreen.tsx`

This task adds the `operations`, `op-drop`, `op-add`, `op-rename`, and `op-filter` phases.

- [ ] **Step 1: Implement the operations menu**

**`operations`** — SelectList with hotkeys:
- `[d]` Drop column → set phase to `op-drop`
- `[a]` Add column → set phase to `op-add`
- `[r]` Rename column → set phase to `op-rename`
- `[f]` Filter rows → set phase to `op-filter`
- `[v]` View current schema → show `transformSchema(sourceSchema, recipe)` columns
- `[u]` Undo last → `setRecipe(prev => prev.slice(0, -1))`
- `Enter` → proceed to `output` (if recipe is not empty)
- `Esc` → `back()`

Display the running recipe summary above the menu (numbered list of queued operations).

Use `useMemo` to compute `currentSchema = transformSchema(sourceSchema!, recipe)` for use in sub-screens.

- [ ] **Step 2: Implement op-drop**

**`op-drop`** — SelectList showing current schema columns. On select, push `{ op: 'drop', column: selected.value }` to recipe and return to `operations`. On Esc, return to `operations`.

- [ ] **Step 3: Implement op-add**

**`op-add`** — Multi-field form:
- Name: TextInput
- Type: cycle through SIMPLE_TYPES with Up/Down arrows
- Nullable: toggle with Space
- Default value: TextInput (parse as JSON for non-string types, or raw string for `string` type). Show hint about `NOW()` and `UUID()` expressions.

On submit, parse the default value:
- If it matches `NOW()` → `{ kind: 'expression', fn: 'NOW' }`
- If it matches `UUID()` → `{ kind: 'expression', fn: 'UUID' }`
- Otherwise → `{ kind: 'literal', value: parsedValue }`

Push to recipe and return to `operations`.

Use Tab/Shift+Tab to navigate between fields. Use `useState` for a `fieldIndex` to track which field is active.

- [ ] **Step 4: Implement op-rename**

**`op-rename`** — Two-step:
1. SelectList of current columns → select which column to rename
2. TextInput for new name → on submit, push `{ op: 'rename', from: selected, to: newName }` and return to `operations`

Use a sub-phase state (e.g., `renameStep: 'select' | 'input'`).

- [ ] **Step 5: Implement op-filter**

**`op-filter`** — TextInput for JS predicate expression. On submit:
1. Compile with `new Function('row', 'return ' + predicate)` — if it throws, show error via toast
2. If `sampleRow` exists, test against it using `buildRowProxy` — show test result
3. Push `{ op: 'filter', predicate }` to recipe and return to `operations`

Show available column names below the input.

- [ ] **Step 6: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/cli/screens/db/DtModifyScreen.tsx
git commit -m "feat(cli): implement DtModifyScreen operations menu and sub-screens"
```

---

### Task 8: Implement DtModifyScreen — output, confirm, running, complete

**Files:**
- Modify: `src/cli/screens/db/DtModifyScreen.tsx`

This task completes the screen with the final phases.

- [ ] **Step 1: Implement the output phase**

**`output`** — Form with:
- Output path: TextInput, pre-filled with `inputPath.replace('.dt', '_modified.dt')` (preserving original extension)
- Overwrite original: toggle (if selected, sets outputPath to inputPath)

On submit, proceed to `confirm`.

- [ ] **Step 2: Implement the confirm phase**

**`confirm`** — Show recipe summary:
- List all operations in numbered format
- Show input file, output file, original column count → transformed column count
- Use `Confirm` component for yes/no

On confirm, proceed to `running`.

- [ ] **Step 3: Implement the running phase**

**`running`** — Use `useAsyncEffect` to call `modifyDtFile()`:

```typescript
import { modifyDtFile } from '../../../core/dt/modify.js';

const [result, err] = await modifyDtFile({
    inputPath: selectedFile!,
    outputPath,
    recipe,
    passphrase: passphrase || undefined,
});
```

Show a `Spinner` while running. On completion, set result state and move to `complete`. On error, move to `error`.

- [ ] **Step 4: Implement the complete phase**

**`complete`** — Show `ModifyResult` summary:
- Rows: read / written / filtered
- Columns: dropped / added / renamed
- Output path
- Duration

Show `[Esc] Back` to return.

- [ ] **Step 5: Implement the error phase**

**`error`** — Show error message in red. `[Esc]` to go back.

- [ ] **Step 6: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/cli/screens/db/DtModifyScreen.tsx
git commit -m "feat(cli): implement DtModifyScreen output, confirm, running, and complete phases"
```

---

### Task 9: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run all DT tests**

Run: `bun test tests/core/dt/modify.test.ts`
Expected: All tests PASS

- [ ] **Step 2: Run full typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: No errors (fix any if found)

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address lint/type issues from dt-modify implementation"
```
