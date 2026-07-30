/**
 * Streaming .dt file reader.
 *
 * Reads .dt files with extension-based input handling:
 * - `.dt`: raw text readline
 * - `.dtz`: gunzip then readline
 * - `.dtzx`: decrypt then gunzip then readline
 *
 * @example
 * ```typescript
 * import { DtReader } from './reader.js';
 *
 * const reader = new DtReader({ filepath: './data/users.dtz' });
 * await reader.open();
 *
 * const schema = reader.schema;
 *
 * for await (const values of reader.rows()) {
 *     // values is DtValue[]
 * }
 *
 * reader.close();
 * ```
 */
import { createReadStream, readFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { gunzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { PassThrough, Transform } from 'node:stream';
import path from 'node:path';
import JSON5 from 'json5';
import { attemptSync } from '@logosdx/utils';

import type { Readable } from 'node:stream';
import type { DtSchema, DtValue, DtReaderOptions } from './types.js';
import { DT_EXTENSIONS, FORMAT_VERSION, MAX_DECOMPRESSED_ARCHIVE_BYTES, MAX_ROW_BYTES } from './constants.js';
import { decryptWithPassphrase } from './crypto.js';

/**
 * Fail the stream when a single line grows past `MAX_ROW_BYTES`.
 *
 * readline buffers until it sees a newline, so newline-free input makes that
 * buffer the whole file regardless of how little the stream itself holds.
 * Capping the line rather than the stream keeps arbitrarily large `.dt` files
 * importable while bounding resident memory.
 */
function createRowLengthGuard(): Transform {

    let sinceNewline = 0;

    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {

            const lastNewline = chunk.lastIndexOf(0x0a);

            sinceNewline = lastNewline === -1
                ? sinceNewline + chunk.length
                : chunk.length - lastNewline - 1;

            if (sinceNewline > MAX_ROW_BYTES) {

                callback(new Error(`.dt row exceeds the ${MAX_ROW_BYTES} byte limit without a line break`));

                return;

            }

            callback(null, chunk);

        },
    });

}

/**
 * Validate the shape of a parsed `.dt` header.
 *
 * Only `v` was ever checked, so a header missing `columns` surfaced to the
 * operator as a minified internal TypeError, and a header with malformed
 * column entries corrupted every row that followed.
 */
function assertDtSchema(parsed: unknown): DtSchema {

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {

        throw new Error('.dt schema line is not an object');

    }

    const schema = parsed as Partial<DtSchema>;

    if (schema.v !== FORMAT_VERSION) {

        throw new Error(`Unsupported .dt format version: ${String(schema.v)}`);

    }

    if (!Array.isArray(schema.columns) || schema.columns.length === 0) {

        throw new Error('.dt schema is missing a non-empty "columns" array');

    }

    schema.columns.forEach((column, i) => {

        if (typeof column !== 'object' || column === null) {

            throw new Error(`.dt schema column ${i} is not an object`);

        }

        if (typeof column.name !== 'string' || column.name.length === 0) {

            throw new Error(`.dt schema column ${i} is missing a "name"`);

        }

        if (typeof column.type !== 'string' || column.type.length === 0) {

            throw new Error(`.dt schema column "${column.name}" is missing a "type"`);

        }

    });

    return schema as DtSchema;

}

/**
 * Pipe `source` through the row-length guard, forwarding errors and teardown.
 *
 * `.pipe()` propagates neither, so without this an upstream ENOENT would go
 * unhandled and `close()` on the returned stream would leave the file
 * descriptor open.
 */
function guardRows(source: Readable, ...upstream: Readable[]): Readable {

    const guard = createRowLengthGuard();

    source.on('error', (err) => guard.destroy(err));

    guard.on('close', () => {

        for (const stream of [source, ...upstream]) {

            stream.destroy();

        }

    });

    return source.pipe(guard);

}

/**
 * Streaming .dt file reader.
 *
 * Handles raw, compressed, and encrypted input based on file extension.
 * Provides schema access and async iteration over rows.
 */
export class DtReader {

    #filepath: string;
    #passphrase?: string;
    #extension: string;
    #schema: DtSchema | null = null;
    #lineReader: AsyncGenerator<DtValue[], void, undefined> | null = null;
    #inputStream: Readable | null = null;

    /**
     * Create a new DtReader.
     *
     * @param options - File path and optional passphrase for .dtzx
     */
    constructor(options: DtReaderOptions) {

        this.#filepath = options.filepath;
        this.#passphrase = options.passphrase;
        this.#extension = path.extname(options.filepath).toLowerCase();

    }

    /** The parsed schema from line 1. Available after open(). */
    get schema(): DtSchema | null {

        return this.#schema;

    }

    /**
     * Open the file and parse the schema header.
     *
     * Must be called before iterating rows.
     */
    async open(): Promise<void> {

        const readable = this.#createReadableStream();
        this.#inputStream = readable;

        // Read first line as schema
        const rl = createInterface({ input: readable, crlfDelay: Infinity });
        const lines = rl[Symbol.asyncIterator]();
        const firstLine = await lines.next();

        if (firstLine.done || !firstLine.value) {

            throw new Error('Empty .dt file — no schema line');

        }

        const [parsed, parseErr] = attemptSync(() => JSON5.parse(firstLine.value) as unknown);

        if (parseErr) {

            throw new Error(`.dt schema line is not valid JSON5: ${parseErr.message}`);

        }

        this.#schema = assertDtSchema(parsed);

        // Store iterator for rows
        this.#lineReader = this.#createRowIterator(lines);

    }

    /**
     * Async generator yielding parsed row value arrays.
     *
     * Each yield is a `DtValue[]` in column order matching the schema.
     *
     * @example
     * ```typescript
     * for await (const values of reader.rows()) {
     *     console.log(values); // [1, "alice@example.com", true, "2024-01-15T10:30:00Z"]
     * }
     * ```
     */
    async *rows(): AsyncGenerator<DtValue[], void, undefined> {

        if (!this.#lineReader) {

            throw new Error('Reader not opened — call open() first');

        }

        yield* this.#lineReader;

    }

    /**
     * Close the reader and release resources.
     */
    close(): void {

        if (this.#inputStream) {

            this.#inputStream.destroy();
            this.#inputStream = null;

        }

    }

    /**
     * Create the readable stream based on file extension.
     */
    #createReadableStream(): Readable {

        if (this.#extension === DT_EXTENSIONS.ENCRYPTED) {

            // .dtzx: read all, decrypt, gunzip, create readable from buffer
            if (!this.#passphrase) {

                throw new Error('Passphrase required for .dtzx files');

            }

            const encrypted = readFileSync(this.#filepath, 'utf8');
            const payload = JSON.parse(encrypted);
            const compressed = decryptWithPassphrase(payload, this.#passphrase);

            // attempt() here because zlib reports the cap as an internal
            // allocation failure; the operator needs to know the archive
            // asked for more than the limit allows.
            const [raw, gunzipErr] = attemptSync(() =>
                gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_ARCHIVE_BYTES }),
            );

            if (gunzipErr || !raw) {

                throw new Error(
                    `.dtzx archive exceeds the ${MAX_DECOMPRESSED_ARCHIVE_BYTES} byte decompression limit `
                    + `or is not valid gzip: ${gunzipErr?.message ?? 'unknown error'}`,
                );

            }

            const stream = new PassThrough();
            stream.end(raw);

            return guardRows(stream);

        }

        if (this.#extension === DT_EXTENSIONS.COMPRESSED) {

            // .dtz: pipe through gunzip
            const fileStream = createReadStream(this.#filepath);
            const gunzip = createGunzip();

            // .pipe() does not forward the source 'error' event, so an
            // unhandled fileStream error (e.g. ENOENT) would otherwise
            // crash the process instead of rejecting open().
            fileStream.on('error', (err) => gunzip.destroy(err));
            fileStream.pipe(gunzip);

            return guardRows(gunzip, fileStream);

        }

        // .dt: raw file stream. No encoding — the guard inspects bytes and
        // readline decodes utf8 for itself.
        return guardRows(createReadStream(this.#filepath));

    }

    /**
     * Create async generator from remaining readline lines.
     */
    async *#createRowIterator(
        lines: AsyncIterableIterator<string>,
    ): AsyncGenerator<DtValue[], void, undefined> {

        const expected = this.#schema!.columns.length;
        let rowNumber = 0;

        for await (const line of { [Symbol.asyncIterator]: () => lines }) {

            const trimmed = line.trim();

            if (trimmed.length === 0) continue;

            rowNumber++;

            const [values, parseErr] = attemptSync(() => JSON5.parse(trimmed) as unknown);

            if (parseErr) {

                throw new Error(`.dt row ${rowNumber} is not valid JSON5: ${parseErr.message}`);

            }

            // An object row, or one whose arity does not match the header,
            // used to be accepted and inserted — producing columns silently
            // filled with the wrong value or with undefined.
            if (!Array.isArray(values)) {

                throw new Error(`.dt row ${rowNumber} is not an array of values`);

            }

            if (values.length !== expected) {

                throw new Error(
                    `.dt row ${rowNumber} has ${values.length} values but the schema declares ${expected} columns`,
                );

            }

            yield values as DtValue[];

        }

    }

}
