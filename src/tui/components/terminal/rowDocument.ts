/**
 * One database row as a readable key/value document.
 *
 * The grid `ResultTable` draws answers "what is in this result"; this answers
 * "what is in this row", which is a different question with a different failure
 * mode. A grid truncates and the reader sees that it truncated. A serializer
 * that meets a value it did not expect either throws or prints a lie, and both
 * look like a bug in the table rather than in the formatter.
 *
 * `ResultTable` formats its cells through `documentValue` for the same reason,
 * so a `bytea` column reads `<binary 40 bytes 0x…>` in the grid and in the
 * document rather than `{"type":"Buffer","data":[0,…` in one and the summary in
 * the other.
 *
 * Every rule below came from asking the four drivers what they actually return,
 * not from reasoning about SQL types. What came back, per dialect:
 *
 * | value | postgres | mysql | mssql | sqlite |
 * |-------|----------|-------|-------|--------|
 * | `NULL` | `null` | `null` | `null` | `null` |
 * | date / timestamp | `Date` | `Date` | `Date` | `string` |
 * | binary | `Buffer` | `Buffer` | `Buffer` | `Uint8Array` |
 * | `bigint` | `string` | `number`, lossy | `string` | `number`, lossy |
 * | `decimal` | `string` | `string` | `number` | `number` |
 * | boolean | `boolean` | `number` 0/1 | `boolean` | `number` 0/1 |
 * | `json` / `jsonb` | parsed object | parsed object | — | `string` |
 *
 * Which produces four rules that are not obvious from the type list:
 *
 * - **`Buffer` is not the only binary.** `bun:sqlite` hands back a plain
 *   `Uint8Array`, so `Buffer.isBuffer` is `false` for exactly the value that
 *   most needs summarizing, and the check has to be on the view rather than on
 *   the subclass. Left alone, either one serializes to
 *   `{"type":"Buffer","data":[0,255,16]}` — the wrapper, not the value.
 * - **`bigint` is a crash, not a formatting choice.** `JSON.stringify` throws a
 *   `TypeError` on one. No noorm connection produces a `bigint` today, but
 *   `readPeekRows` accepts any `Kysely` instance and every one of these drivers
 *   has an option that turns large integers into `BigInt`. A crash in a viewer
 *   is not worth the wager.
 * - **`Date` is not always valid.** MySQL's zero date (`0000-00-00`) arrives as
 *   an `Invalid Date`, and `toISOString()` throws on it.
 * - **`null` has to survive.** It is one of three things that print alike if
 *   anything coerces to a string on the way out: `null`, the string `"null"`,
 *   and `''`. JSON keeps them apart by quoting, and so does YAML — `yaml`
 *   quotes a string that would otherwise parse as a null.
 *
 * @example
 * renderRowDocument({ id: 1n, blob: Buffer.of(255) }, ['id', 'blob'], 'yaml');
 * // id: "1"
 * // blob: <binary 1 byte 0xff>
 */
import YAML from 'yaml';

/**
 * How a row is written out.
 *
 * Both, because a reader wants different things from them: YAML to read, JSON
 * to paste into something else.
 */
export type RowFormat = 'json' | 'yaml';

/**
 * What a reader gets before they choose.
 *
 * YAML, because the ask is a key/value document one field per line and that is
 * what YAML is — JSON spends its first and last line on braces and every line
 * in between on quotes and a trailing comma, which is the right trade only when
 * something other than a person is going to parse it.
 */
export const DEFAULT_ROW_FORMAT: RowFormat = 'yaml';

/** Bytes a binary summary shows before it gives up and says how many there are. */
const BINARY_PREVIEW_BYTES = 12;

/**
 * The format the reader last chose, for as long as the process lives.
 *
 * Module state rather than React state because every level that could hold it
 * is torn down between two rows: the row view unmounts on Escape, the peek
 * unmounts on Escape, and the detail screen unmounts on navigating to another
 * table. A reader who prefers JSON would be re-pressing `f` on every row.
 *
 * Deliberately not persisted. `AppContext` already carries session-scoped
 * explore state (`exploreFilters`) and is where this belongs the day it needs
 * to outlive the process or be visible to another screen; until then a context
 * field would force every test that renders the overlay to wrap it in a
 * provider for a single boolean.
 */
let sessionFormat: RowFormat = DEFAULT_ROW_FORMAT;

/**
 * The format the next row view opens in.
 *
 * @example
 * const [format, setFormat] = useState(preferredRowFormat);
 */
export function preferredRowFormat(): RowFormat {

    return sessionFormat;

}

/**
 * Remember a format for the rest of the session.
 *
 * @example
 * rememberRowFormat('json');
 */
export function rememberRowFormat(format: RowFormat): void {

    sessionFormat = format;

}

/**
 * Whether this is a binary value from any of the four drivers.
 *
 * `Buffer.isBuffer` is not enough: `bun:sqlite` returns `Uint8Array`, and a
 * driver is free to return any typed array view over the bytes.
 */
function isBinary(value: object): value is ArrayBufferView {

    return ArrayBuffer.isView(value);

}

/**
 * A binary value as something a person can read.
 *
 * Names the length first because that is the part a reader can act on, and
 * shows a hex preview because it is often enough to recognise what the column
 * holds — a PNG header, a UUID, a zero fill.
 *
 * @example
 * describeBinary(Buffer.from([0, 255, 16])); // '<binary 3 bytes 0x00ff10>'
 */
export function describeBinary(view: ArrayBufferView): string {

    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const unit = bytes.length === 1 ? 'byte' : 'bytes';

    if (bytes.length === 0) return '<binary 0 bytes>';

    const preview = Buffer.from(bytes.subarray(0, BINARY_PREVIEW_BYTES)).toString('hex');
    const elided = bytes.length > BINARY_PREVIEW_BYTES ? '…' : '';

    return `<binary ${bytes.length} ${unit} 0x${preview}${elided}>`;

}

/**
 * One driver value as something both serializers can carry.
 *
 * Recursive, because a `jsonb` column arrives already parsed and may hold any
 * of the above at any depth — a `Buffer` cannot appear inside one, but an
 * unexpected shape is exactly what this function exists to survive.
 *
 * @example
 * documentValue(new Date('2024-03-01T00:00:00Z')); // '2024-03-01T00:00:00.000Z'
 * documentValue(9007199254740993n);                // '9007199254740993'
 */
export function documentValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {

    if (value === null || value === undefined) return null;

    // Before the object branch: a bigint is a primitive, and the only value
    // here that makes JSON.stringify throw rather than mis-render.
    if (typeof value === 'bigint') return value.toString();

    if (typeof value !== 'object') {

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {

            return value;

        }

        return String(value);

    }

    if (value instanceof Date) {

        return Number.isNaN(value.getTime()) ? '<invalid date>' : value.toISOString();

    }

    if (isBinary(value)) return describeBinary(value);

    // A row from a driver cannot be circular, but this walks whatever came back
    // rather than what should have, and a cycle is an infinite loop rather than
    // a bad render.
    if (seen.has(value)) return '<circular>';

    seen.add(value);

    if (Array.isArray(value)) return value.map((entry) => documentValue(entry, seen));

    const out: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {

        out[key] = documentValue(entry, seen);

    }

    return out;

}

/**
 * A whole row, ordered by the column list rather than by the object's keys.
 *
 * The column list is the table's ordinal order, which is the order the reader
 * just saw in the grid. Any key the list does not mention is appended rather
 * than dropped: the list comes from the catalog and the row comes from the
 * driver, and a reader looking for a value should never lose it to a
 * disagreement between the two.
 *
 * @example
 * documentRow({ b: 2, a: 1 }, ['a', 'b']); // { a: 1, b: 2 }
 */
export function documentRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {

    const document: Record<string, unknown> = {};
    const seen = new WeakSet<object>();

    for (const column of columns) {

        document[column] = documentValue(row[column], seen);

    }

    for (const key of Object.keys(row)) {

        if (key in document) continue;

        document[key] = documentValue(row[key], seen);

    }

    return document;

}

/**
 * The row as text, ready to be wrapped and windowed.
 *
 * `lineWidth: 0` turns off YAML's folding. Left on, `yaml` breaks a value
 * longer than 80 columns across lines of its own choosing, which makes a row's
 * height depend on its content and puts the viewport's line arithmetic out by
 * however much it folded. Wrapping is the viewport's job and it knows the
 * terminal width; this only has to produce one line per field.
 *
 * @example
 * renderRowDocument(row, peek.columns, 'yaml').split('\n');
 */
export function renderRowDocument(
    row: Record<string, unknown>,
    columns: string[],
    format: RowFormat,
): string {

    const document = documentRow(row, columns);

    if (format === 'json') return JSON.stringify(document, null, 2);

    return YAML.stringify(document, { lineWidth: 0 }).trimEnd();

}
