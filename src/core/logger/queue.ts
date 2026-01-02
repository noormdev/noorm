/**
 * WriteQueue - Non-blocking file write queue for logging.
 *
 * Provides ordered, non-blocking writes to a log file. Entries are
 * enqueued immediately and written asynchronously. Supports file
 * path switching (for log rotation) with automatic flush.
 *
 * @example
 * ```typescript
 * const queue = new WriteQueue('.noorm/noorm.log');
 * await queue.start();
 *
 * queue.enqueue('{"time":"...","level":"info"}\n');
 * queue.enqueue('{"time":"...","level":"warn"}\n');
 *
 * await queue.flush(); // Ensure all writes complete
 * await queue.stop();
 * ```
 */
import { mkdir } from 'node:fs/promises';
import { createWriteStream, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Queue statistics.
 */
export interface QueueStats {

    /** Number of entries waiting to be written */
    pending: number;

    /** Total number of entries written */
    totalWritten: number;

    /** Total bytes written */
    totalBytes: number;

    /** Whether a write is currently in progress */
    isWriting: boolean;

}

/**
 * Non-blocking write queue for log files.
 */
export class WriteQueue {

    #filepath: string;
    #stream: WriteStream | null = null;
    #queue: string[] = [];
    #isRunning = false;
    #isStopping = false;
    #isWriting = false;
    #totalWritten = 0;
    #totalBytes = 0;
    #flushPromise: Promise<void> | null = null;
    #flushResolve: (() => void) | null = null;

    /**
     * Create a new write queue.
     *
     * @param filepath - Path to the log file
     */
    constructor(filepath: string) {

        this.#filepath = filepath;

    }

    // ─────────────────────────────────────────────────────────────
    // Getters
    // ─────────────────────────────────────────────────────────────

    /**
     * Current file path.
     */
    get filepath(): string {

        return this.#filepath;

    }

    /**
     * Whether the queue is running.
     */
    get isRunning(): boolean {

        return this.#isRunning;

    }

    /**
     * Queue statistics.
     */
    get stats(): QueueStats {

        return {
            pending: this.#queue.length,
            totalWritten: this.#totalWritten,
            totalBytes: this.#totalBytes,
            isWriting: this.#isWriting,
        };

    }

    // ─────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────

    /**
     * Start the queue.
     *
     * Creates the directory if needed and opens the file stream.
     */
    async start(): Promise<void> {

        if (this.#isRunning) return;

        await mkdir(dirname(this.#filepath), { recursive: true });

        this.#stream = createWriteStream(this.#filepath, { flags: 'a' });
        this.#isRunning = true;
        this.#isStopping = false;

    }

    /**
     * Stop the queue.
     *
     * Flushes pending writes before closing the stream.
     */
    async stop(): Promise<void> {

        if (!this.#isRunning) return;

        this.#isStopping = true;

        // Flush any pending writes
        await this.flush();

        // Close the stream
        if (this.#stream) {

            await new Promise<void>((resolve, reject) => {

                this.#stream!.end((err: Error | null | undefined) => {

                    if (err) reject(err);
                    else resolve();

                });

            });

            this.#stream = null;

        }

        this.#isRunning = false;
        this.#isStopping = false;

    }

    // ─────────────────────────────────────────────────────────────
    // Operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Enqueue an entry for writing.
     *
     * Non-blocking; returns immediately. Entry will be written
     * asynchronously in order.
     *
     * @param line - The line to write (should include newline)
     */
    enqueue(line: string): void {

        if (!this.#isRunning || this.#isStopping) return;

        this.#queue.push(line);
        this.#processQueue();

    }

    /**
     * Flush all pending writes.
     *
     * Resolves when all queued entries have been written.
     */
    async flush(): Promise<void> {

        if (this.#queue.length === 0 && !this.#isWriting) return;

        if (this.#flushPromise) {

            return this.#flushPromise;

        }

        this.#flushPromise = new Promise<void>((resolve) => {

            this.#flushResolve = resolve;

        });

        // Trigger processing if not already running
        this.#processQueue();

        await this.#flushPromise;

        this.#flushPromise = null;
        this.#flushResolve = null;

    }

    /**
     * Switch to a new file path.
     *
     * Flushes pending writes to the current file before switching.
     *
     * @param newPath - New file path
     */
    async setFilepath(newPath: string): Promise<void> {

        // Flush current writes
        await this.flush();

        // Close current stream
        if (this.#stream) {

            await new Promise<void>((resolve, reject) => {

                this.#stream!.end((err: Error | null | undefined) => {

                    if (err) reject(err);
                    else resolve();

                });

            });

        }

        // Update path and open new stream
        this.#filepath = newPath;

        await mkdir(dirname(this.#filepath), { recursive: true });

        this.#stream = createWriteStream(this.#filepath, { flags: 'a' });

    }

    // ─────────────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────────────

    /**
     * Process queued entries.
     */
    #processQueue(): void {

        if (this.#isWriting || this.#queue.length === 0 || !this.#stream) {

            // Nothing to do, resolve flush if waiting
            if (this.#queue.length === 0 && !this.#isWriting && this.#flushResolve) {

                this.#flushResolve();

            }

            return;

        }

        this.#isWriting = true;

        const line = this.#queue.shift()!;
        const bytes = Buffer.byteLength(line);

        this.#stream.write(line, (err) => {

            this.#isWriting = false;

            if (!err) {

                this.#totalWritten++;
                this.#totalBytes += bytes;

            }

            // Process next entry
            this.#processQueue();

        });

    }

}
