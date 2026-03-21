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
import { randomBytes, randomUUID } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { attempt, attemptSync } from '@logosdx/utils';

import { observer } from '../observer.js';
import { DtReader } from './reader.js';
import { DtWriter } from './writer.js';

import type { DtColumn, DtSchema, DtValue, UniversalType } from './types.js';

// ---------------------------------------------------------------------------
// Type zero values — used when coercing nulls for not-null columns
// ---------------------------------------------------------------------------

const TYPE_ZERO_VALUES: Record<string, DtValue> = {
    string: '',
    int: 0,
    bigint: '0',
    float: 0,
    decimal: '0',
    bool: false,
    timestamp: '1970-01-01T00:00:00.000Z',
    date: '1970-01-01',
    uuid: '00000000-0000-0000-0000-000000000000',
    json: ['{}', 'raw'],
    binary: ['', 'raw'],
    vector: ['[]', 'raw'],
    array: ['[]', 'raw'],
    text: ['', 'raw'],
    custom: ['', 'raw'],
};

// ---------------------------------------------------------------------------
// Recipe types
// ---------------------------------------------------------------------------

export type LiteralDefault = { kind: 'literal'; value: unknown };
export type ExpressionDefault = { kind: 'expression'; fn: 'NOW' | 'UUID' };
export type DefaultValue = LiteralDefault | ExpressionDefault;

export type DropColumn = { op: 'drop'; column: string };
export type AddColumn = { op: 'add'; column: string; type: UniversalType; default: DefaultValue; nullable?: boolean };
export type RenameColumn = { op: 'rename'; from: string; to: string };
export type AlterColumn = { op: 'alter'; column: string; nullable: boolean };
export type FilterRows = { op: 'filter'; predicate: string };

export type Modification = DropColumn | AddColumn | RenameColumn | AlterColumn | FilterRows;
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
 *
 * @example
 * ```typescript
 * const recipe: Recipe = [
 *     { op: 'drop', column: 'updated_at' },
 *     { op: 'rename', from: 'username', to: 'user_name' },
 * ];
 * const newSchema = transformSchema(schema, recipe);
 * ```
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
                nullable: mod.nullable !== false,
            });

        }
        else if (mod.op === 'alter') {

            const col = columns.find(c => c.name === mod.column);

            if (col) {

                col.nullable = mod.nullable;

            }

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
 * Applies each operation to a working copy of the column list so that
 * subsequent operations see the result of prior ones (e.g. rename then drop).
 * Returns [true, null] on success or [null, Error] with a descriptive message.
 *
 * @example
 * ```typescript
 * const [ok, err] = validateRecipe(schema, recipe);
 * if (err) throw err;
 * ```
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
        else if (mod.op === 'alter') {

            const exists = columns.some(c => c.name === mod.column);

            if (!exists) {

                return [null, new Error(`Cannot alter column "${mod.column}" — does not exist`)];

            }

            const col = columns.find(c => c.name === mod.column)!;
            col.nullable = mod.nullable;

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

            // Attempt to compile the predicate as a JS function body to catch syntax errors.
            // Uses new Function() so invalid JS is caught before runtime row processing.
            const [, compileErr] = attemptSync(() => new Function('row', 'return ' + mod.predicate));

            if (compileErr) {

                return [null, new Error(`Invalid filter predicate: ${compileErr.message}`)];

            }

        }

    }

    return [true, null];

}

// ---------------------------------------------------------------------------
// Row proxy
// ---------------------------------------------------------------------------

/**
 * Creates a Proxy for a row that supports both named and positional access.
 *
 * Used by filter predicates so users can write `row.username` or `row[0]`.
 * Name-to-index map is built once per proxy for O(1) named lookups.
 *
 * @example
 * ```typescript
 * const proxy = buildRowProxy(columns, values);
 * proxy.username; // named access
 * proxy[0];      // positional access
 * ```
 */
export function buildRowProxy(
    columns: Pick<DtColumn, 'name'>[],
    values: DtValue[],
): Record<string, DtValue> & Record<number, DtValue> {

    const nameMap: Record<string, number> = {};

    for (let i = 0; i < columns.length; i++) {

        nameMap[columns[i]!.name] = i;

    }

    return new Proxy({} as Record<string, DtValue> & Record<number, DtValue>, {

        get(_target, prop) {

            if (typeof prop === 'symbol') return undefined;

            const idx = Number(prop);

            if (!Number.isNaN(idx) && Number.isInteger(idx)) {

                return values[idx];

            }

            const colIdx = nameMap[prop];

            if (colIdx !== undefined) {

                return values[colIdx];

            }

            return undefined;

        },

    });

}

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

    /** Default value factories for added columns. */
    addedDefaults: (() => DtValue)[];

}

/**
 * Builds a column index map from original schema to transformed schema.
 *
 * Processes operations incrementally (matching transformSchema/validateRecipe)
 * to correctly handle complex recipes like [drop(A), add(A), drop(A)].
 * Default factories: literal → closure over value, NOW → computed once,
 * UUID → randomUUID() per call.
 */
function buildColumnMap(
    originalColumns: DtColumn[],
    recipe: Recipe,
): ColumnMap {

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
 * Emits dt:modify:start, dt:modify:progress (every 100 rows), and dt:modify:complete events.
 *
 * @returns Error tuple: [ModifyResult, null] on success, [null, Error] on failure
 *
 * @example
 * ```typescript
 * const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });
 * if (err) console.error(err.message);
 * ```
 */
export async function modifyDtFile(
    options: ModifyOptions,
): Promise<[ModifyResult, null] | [null, Error]> {

    const { inputPath, outputPath, recipe, passphrase } = options;
    const start = Date.now();

    const reader = new DtReader({ filepath: inputPath, passphrase });
    const [, openErr] = await attempt(() => reader.open());

    if (openErr) {

        return [null, new Error(`Failed to open DT file: ${openErr.message}`)];

    }

    const sourceSchema = reader.schema!;

    const [, validationErr] = validateRecipe(sourceSchema, recipe);

    if (validationErr) {

        reader.close();

        return [null, validationErr];

    }

    const transformedSchema = transformSchema(sourceSchema, recipe);
    const columnMap = buildColumnMap(sourceSchema.columns, recipe);

    const filterFns: ((row: Record<string, DtValue>) => boolean)[] = [];

    for (const mod of recipe) {

        if (mod.op === 'filter') {

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

    // Always write to a temp file first, then swap into place.
    // This prevents corruption when inputPath === outputPath (the reader
    // still holds the input open while the writer would truncate it).
    // The temp file must keep the original extension so DtWriter uses
    // the correct format (raw/gzip/encrypted) based on extension detection.
    const tmpSuffix = randomBytes(4).toString('hex');
    const ext = path.extname(outputPath);
    const base = outputPath.slice(0, -ext.length || undefined);
    const tmpPath = `${base}.tmp-${tmpSuffix}${ext}`;

    const writer = new DtWriter({
        filepath: tmpPath,
        schema: transformedSchema,
        passphrase,
    });

    const [, writerErr] = await attempt(() => writer.open());

    if (writerErr) {

        reader.close();

        return [null, new Error(`Failed to open output file: ${writerErr.message}`)];

    }

    let rowsRead = 0;
    let rowsWritten = 0;
    let rowsFiltered = 0;

    const countMods = (op: string) => recipe.filter(m => m.op === op).length;

    observer.emit('dt:modify:start', {
        inputPath,
        outputPath,
        recipeLength: recipe.length,
    });

    // Build not-null coercion map: column index → zero value for that type.
    // Only includes columns marked nullable: false in the transformed schema.
    const notNullCoercions: { idx: number; zero: DtValue }[] = [];

    for (let i = 0; i < transformedSchema.columns.length; i++) {

        const col = transformedSchema.columns[i]!;

        if (col.nullable === false) {

            const zero = TYPE_ZERO_VALUES[col.type];

            if (zero !== undefined) {

                notNullCoercions.push({ idx: i, zero });

            }

        }

    }

    for await (const sourceRow of reader.rows()) {

        rowsRead++;

        const remapped: DtValue[] = columnMap.keepIndices.map(i => sourceRow[i]!);

        for (const factory of columnMap.addedDefaults) {

            remapped.push(factory());

        }

        // Replace nulls with type zero values for not-null columns
        for (const { idx, zero } of notNullCoercions) {

            if (remapped[idx] === null || remapped[idx] === undefined) {

                remapped[idx] = zero;

            }

        }

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

        if (rowsRead % 100 === 0) {

            observer.emit('dt:modify:progress', { rowsRead, rowsWritten, rowsFiltered });

        }

    }

    reader.close();
    await writer.close();

    // Swap temp file into final position.
    // If overwriting the input file, unlink first to avoid EBUSY on some platforms.
    const resolvedOutput = path.resolve(outputPath);
    const resolvedTmp = path.resolve(tmpPath);

    if (resolvedOutput !== resolvedTmp) {

        const [, unlinkErr] = await attempt(() => unlink(resolvedOutput));

        // ENOENT is fine — output file may not exist yet
        if (unlinkErr && (unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {

            return [null, new Error(`Failed to remove existing output file: ${unlinkErr.message}`)];

        }

        const [, renameErr] = await attempt(() => rename(resolvedTmp, resolvedOutput));

        if (renameErr) {

            return [null, new Error(`Failed to move temp file to output: ${renameErr.message}`)];

        }

    }

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
