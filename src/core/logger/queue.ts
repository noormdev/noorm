/**
 * Write Queue
 *
 * A non-blocking queue that streams log entries to a file.
 * Entries are enqueued immediately (non-blocking) and written
 * sequentially in order.
 *
 * The queue guarantees:
 * - Order preservation (first enqueued = first written)
 * - Non-blocking enqueue (callers never wait)
 * - Graceful shutdown (flush waits for pending writes)
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { attempt } from '@logosdx/utils'

import { observer } from '../observer.js'
import type { QueueEntry, QueueStats } from './types.js'


/**
 * Write queue for async file operations.
 *
 * @example
 * ```typescript
 * const queue = new WriteQueue('/path/to/log.log')
 * await queue.start()
 *
 * queue.enqueue('{"event":"test"}\n')
 * queue.enqueue('{"event":"test2"}\n')
 *
 * await queue.flush()  // Wait for all writes
 * await queue.stop()
 * ```
 */
export class WriteQueue {

    #filepath: string
    #queue: QueueEntry[] = []
    #isWriting = false
    #isStarted = false
    #isStopping = false
    #totalWritten = 0
    #totalBytes = 0

    // Promise that resolves when current write cycle completes
    #writePromise: Promise<void> | null = null

    // Resolve function for flush waiters
    #flushResolvers: Array<() => void> = []

    constructor(filepath: string) {

        this.#filepath = filepath
    }


    /**
     * Get the log file path.
     */
    get filepath(): string {

        return this.#filepath
    }


    /**
     * Check if the queue is running.
     */
    get isRunning(): boolean {

        return this.#isStarted && !this.#isStopping
    }


    /**
     * Get queue statistics.
     */
    get stats(): QueueStats {

        return {
            pending: this.#queue.length,
            totalWritten: this.#totalWritten,
            totalBytes: this.#totalBytes,
            isWriting: this.#isWriting,
        }
    }


    /**
     * Start the queue.
     *
     * Creates the log directory if it doesn't exist.
     */
    async start(): Promise<void> {

        if (this.#isStarted) {

            return
        }

        // Ensure directory exists
        const dir = dirname(this.#filepath)
        const [_, err] = await attempt(() => mkdir(dir, { recursive: true }))

        if (err) {

            throw new Error(`Failed to create log directory: ${err.message}`)
        }

        this.#isStarted = true
        this.#isStopping = false
    }


    /**
     * Stop the queue.
     *
     * Flushes all pending entries before stopping.
     */
    async stop(): Promise<void> {

        if (!this.#isStarted) {

            return
        }

        this.#isStopping = true

        // Wait for pending writes
        await this.flush()

        this.#isStarted = false
        this.#isStopping = false
    }


    /**
     * Enqueue a log line for writing.
     *
     * This is non-blocking - the caller doesn't wait for the write.
     *
     * @param line - Serialized log entry (JSON + newline)
     */
    enqueue(line: string): void {

        if (!this.#isStarted || this.#isStopping) {

            return
        }

        this.#queue.push({
            line,
            enqueuedAt: Date.now(),
        })

        // Trigger write cycle if not already writing
        this.#startWriteCycle()
    }


    /**
     * Flush all pending entries to disk.
     *
     * Returns when the queue is empty and all writes are complete.
     *
     * @example
     * ```typescript
     * queue.enqueue(entry1)
     * queue.enqueue(entry2)
     * await queue.flush()  // Wait for both to be written
     * ```
     */
    async flush(): Promise<void> {

        // If nothing pending and not writing, we're done
        if (this.#queue.length === 0 && !this.#isWriting) {

            return
        }

        // Create a promise that resolves when queue is empty
        return new Promise((resolve) => {

            this.#flushResolvers.push(resolve)

            // Trigger write cycle if not already running
            this.#startWriteCycle()
        })
    }


    /**
     * Update the file path (for rotation).
     *
     * Flushes pending writes to old file before switching.
     */
    async setFilepath(newPath: string): Promise<void> {

        // Flush pending writes to old file
        await this.flush()

        // Update path
        this.#filepath = newPath

        // Ensure new directory exists
        const dir = dirname(this.#filepath)
        const [_, err] = await attempt(() => mkdir(dir, { recursive: true }))

        if (err) {

            throw new Error(`Failed to create log directory: ${err.message}`)
        }
    }


    /**
     * Start the write cycle if not already running.
     */
    #startWriteCycle(): void {

        if (this.#isWriting || this.#queue.length === 0) {

            return
        }

        this.#isWriting = true
        this.#writePromise = this.#writeCycle()
    }


    /**
     * Process queue entries sequentially.
     */
    async #writeCycle(): Promise<void> {

        while (this.#queue.length > 0) {

            const entry = this.#queue[0]

            if (!entry) {

                this.#queue.shift()
                continue
            }

            const [_, err] = await attempt(() =>
                appendFile(this.#filepath, entry.line, 'utf-8')
            )

            if (err) {

                // Emit error but continue processing
                observer.emit('logger:error', { error: err })

                // Remove failed entry to avoid infinite loop
                this.#queue.shift()
                continue
            }

            // Success - update stats and dequeue
            this.#queue.shift()
            this.#totalWritten++
            this.#totalBytes += entry.line.length
        }

        this.#isWriting = false
        this.#writePromise = null

        // Resolve any flush waiters
        for (const resolve of this.#flushResolvers) {

            resolve()
        }

        this.#flushResolvers = []
    }
}
