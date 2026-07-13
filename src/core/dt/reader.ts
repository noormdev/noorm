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
import { PassThrough } from 'node:stream';
import path from 'node:path';
import JSON5 from 'json5';

import type { Readable } from 'node:stream';
import type { DtSchema, DtValue, DtReaderOptions } from './types.js';
import { DT_EXTENSIONS } from './constants.js';
import { decryptWithPassphrase } from './crypto.js';

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

        this.#schema = JSON5.parse(firstLine.value) as DtSchema;

        // Validate version
        if (this.#schema.v !== 1) {

            throw new Error(`Unsupported .dt format version: ${this.#schema.v}`);

        }

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
            const raw = gunzipSync(compressed);

            const stream = new PassThrough();
            stream.end(raw);

            return stream;

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

            return gunzip;

        }

        // .dt: raw file stream
        return createReadStream(this.#filepath, { encoding: 'utf8' });

    }

    /**
     * Create async generator from remaining readline lines.
     */
    async *#createRowIterator(
        lines: AsyncIterableIterator<string>,
    ): AsyncGenerator<DtValue[], void, undefined> {

        for await (const line of { [Symbol.asyncIterator]: () => lines }) {

            const trimmed = line.trim();

            if (trimmed.length === 0) continue;

            yield JSON5.parse(trimmed) as DtValue[];

        }

    }

}
