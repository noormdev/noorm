/**
 * Streaming .dt file writer.
 *
 * Writes .dt files in JSON5 format with extension-based output handling:
 * - `.dt`: raw text
 * - `.dtz`: gzip-compressed stream
 * - `.dtzx`: gzip buffer then encrypt with passphrase
 *
 * @example
 * ```typescript
 * import { DtWriter } from './writer.js';
 *
 * const writer = new DtWriter({
 *     filepath: './data/users.dtz',
 *     schema: { v: 1, d: 'postgresql', dv: '16.2', t: 'users', columns: [...] },
 * });
 *
 * await writer.open();
 * await writer.writeRows(serializedRows);
 * await writer.close();
 * ```
 */
import { createWriteStream, writeFileSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import JSON5 from 'json5';

import type { Writable } from 'node:stream';
import type { DtSchema, DtValue, DtWriterOptions } from './types.js';
import { DT_EXTENSIONS } from './constants.js';
import { encryptWithPassphrase } from './crypto.js';

/**
 * Streaming .dt file writer.
 *
 * Handles raw, compressed, and encrypted output based on file extension.
 * Tracks bytes written for progress reporting.
 */
export class DtWriter {

    #filepath: string;
    #schema: DtSchema;
    #passphrase?: string;
    #extension: string;
    #stream: Writable | null = null;
    #passthrough: PassThrough | null = null;
    #pipelinePromise: Promise<void> | null = null;
    #bytesWritten = 0;
    #rowsWritten = 0;
    #buffer: Buffer[] | null = null;

    /**
     * Create a new DtWriter.
     *
     * @param options - File path, schema, and optional passphrase
     */
    constructor(options: DtWriterOptions) {

        this.#filepath = options.filepath;
        this.#schema = options.schema;
        this.#passphrase = options.passphrase;
        this.#extension = path.extname(options.filepath).toLowerCase();

    }

    /** Total bytes written to disk. */
    get bytesWritten(): number {

        return this.#bytesWritten;

    }

    /** Total rows written. */
    get rowsWritten(): number {

        return this.#rowsWritten;

    }

    /**
     * Open the writer and write the schema header.
     *
     * Must be called before writing any rows.
     */
    async open(): Promise<void> {

        if (this.#extension === DT_EXTENSIONS.ENCRYPTED) {

            // .dtzx: buffer everything, encrypt on close
            if (!this.#passphrase) {

                throw new Error('Passphrase required for .dtzx files');

            }

            this.#buffer = [];
            const schemaLine = JSON5.stringify(this.#schema) + '\n';
            this.#buffer.push(Buffer.from(schemaLine, 'utf8'));

            return;

        }

        // .dt or .dtz: streaming output
        const fileStream = createWriteStream(this.#filepath);
        const schemaLine = JSON5.stringify(this.#schema) + '\n';

        if (this.#extension === DT_EXTENSIONS.COMPRESSED) {

            // .dtz: pipe through gzip
            this.#passthrough = new PassThrough();
            const gzip = createGzip();

            this.#pipelinePromise = pipeline(this.#passthrough, gzip, fileStream);
            this.#stream = this.#passthrough;
            this.#writeToStream(schemaLine);

        }
        else {

            // .dt: raw output
            this.#stream = fileStream;
            this.#writeToStream(schemaLine);

        }

    }

    /**
     * Write a single serialized row.
     *
     * @param values - Serialized .dt values in column order
     */
    writeRow(values: DtValue[]): void {

        const line = JSON5.stringify(values) + '\n';

        if (this.#buffer) {

            this.#buffer.push(Buffer.from(line, 'utf8'));

        }
        else {

            this.#writeToStream(line);

        }

        this.#rowsWritten++;

    }

    /**
     * Write multiple serialized rows.
     *
     * @param rows - Array of serialized row value arrays
     */
    writeRows(rows: DtValue[][]): void {

        for (const row of rows) {

            this.writeRow(row);

        }

    }

    /**
     * Close the writer and finalize the file.
     *
     * For .dtzx files, this is where compression and encryption happen.
     */
    async close(): Promise<void> {

        if (this.#buffer) {

            // .dtzx: compress then encrypt the buffered content
            const { gzipSync } = await import('node:zlib');

            const raw = Buffer.concat(this.#buffer);
            const compressed = gzipSync(raw);
            const payload = encryptWithPassphrase(compressed, this.#passphrase!);

            const payloadJson = JSON.stringify(payload);
            writeFileSync(this.#filepath, payloadJson, 'utf8');
            this.#bytesWritten = Buffer.byteLength(payloadJson, 'utf8');
            this.#buffer = null;

            return;

        }

        if (this.#passthrough) {

            // .dtz: end the passthrough and wait for pipeline
            this.#passthrough.end();
            await this.#pipelinePromise;

        }
        else if (this.#stream) {

            // .dt: end the file stream
            await new Promise<void>((resolve, reject) => {

                this.#stream!.end(() => resolve());
                this.#stream!.on('error', reject);

            });

        }

    }

    /**
     * Write a string to the active stream and track bytes.
     */
    #writeToStream(data: string): void {

        if (!this.#stream) {

            throw new Error('Writer not opened');

        }

        const buf = Buffer.from(data, 'utf8');
        this.#bytesWritten += buf.length;
        this.#stream.write(buf);

    }

}
