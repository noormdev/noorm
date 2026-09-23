/**
 * Statement watcher: `file:progress` reports and server-side cancel for the
 * files of one run. Lifecycle and per-dialect behavior are in
 * docs/dev/runner.md, "Long-Running Statements".
 */
import { sql } from 'kysely';
import { attempt, runWithTimeout } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import { observer } from '../observer.js';
import { SERVER_CANCEL, SESSION_ID_SQL, readSessionId } from '../connection/session.js';
import { OperationAbortedError } from '../shared/abort.js';
import { STATEMENT_PROBES } from './statement-probes.js';
import type { Dialect } from '../connection/types.js';
import type { StatementStatus } from './statement-probes.js';

const DEFAULT_WATCH_DELAY_MS = 10_000;
const DEFAULT_WATCH_INTERVAL_MS = 10_000;

/** How long a report or cancel waits for the side connection before the watcher gives it up for the run. */
const SIDE_CONNECTION_WAIT_MS = 5_000;

interface StatementWatcherOptions {
    /** Without a probe for the dialect, reports carry elapsed time only. */
    dialect?: Dialect;

    /** Aborting asks the server to cancel whatever statement is running. */
    signal?: AbortSignal;

    delayMs?: number;
    intervalMs?: number;
}

interface WatchedStatement {
    filepath: string;
    sessionId: number | null;
    startedAt: number;
    timer: ReturnType<typeof setTimeout> | undefined;
    finished: boolean;
    cancelling: Promise<void> | null;
}

/**
 * Watches the statements of one run and cancels them on abort.
 *
 * One watcher per run: it owns the side connection, and `close()` must be
 * called when the run ends to return that connection to the pool.
 *
 * @example
 * const watcher = new StatementWatcher(context.db, { dialect, signal });
 *
 * try {
 *
 *     const err = await watcher.run(filepath, context.db, (conn) =>
 *         executeSqlBody({ ...context, db: conn }, sqlContent));
 *
 * }
 * finally {
 *
 *     await watcher.close();
 *
 * }
 */
export class StatementWatcher<DB> {

    #pool: Kysely<DB>;
    #dialect: Dialect | undefined;
    #signal: AbortSignal | undefined;
    #delayMs: number;
    #intervalMs: number;

    #active: WatchedStatement | null = null;
    #side: Promise<Kysely<DB> | null> | null = null;
    #sideAbandoned = false;
    #releaseSide: (() => void) | null = null;
    #sideHeld: Promise<unknown> = Promise.resolve();
    #closed = false;

    #onAbort = (): void => {

        const statement = this.#active;

        if (statement) void this.#cancel(statement);

    };

    /**
     * @param pool - Root connection pool the side connection is checked out
     *   from. Never a transaction: the side connection must be a separate session.
     */
    constructor(pool: Kysely<DB>, options: StatementWatcherOptions = {}) {

        this.#pool = pool;
        this.#dialect = options.dialect;
        this.#signal = options.signal;
        this.#delayMs = options.delayMs ?? DEFAULT_WATCH_DELAY_MS;
        this.#intervalMs = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;

        this.#signal?.addEventListener('abort', this.#onAbort, { once: true });

    }

    /**
     * Run `fn` on one pinned connection while watching it.
     *
     * A transaction is already one connection, so it is used as is; anything
     * else is pinned with `connection()` so the session id read up front is
     * the session the SQL runs on.
     *
     * @throws OperationAbortedError when the signal aborted before `fn` started
     */
    async run<T>(filepath: string, executor: Kysely<DB>, fn: (conn: Kysely<DB>) => Promise<T>): Promise<T> {

        if (executor.isTransaction) {

            return this.#watch(filepath, executor, fn);

        }

        return executor.connection().execute((conn) => this.#watch(filepath, conn, fn));

    }

    /**
     * Stop watching and return the side connection to the pool.
     */
    async close(): Promise<void> {

        this.#closed = true;
        this.#signal?.removeEventListener('abort', this.#onAbort);
        this.#releaseSide?.();

        await this.#sideHeld;

    }

    async #watch<T>(filepath: string, conn: Kysely<DB>, fn: (conn: Kysely<DB>) => Promise<T>): Promise<T> {

        const sessionId = await this.#readSessionId(conn);
        const statement: WatchedStatement = {
            filepath, sessionId, startedAt: performance.now(), timer: undefined, finished: false, cancelling: null,
        };

        // The abort listener fires once and finds nothing active before this
        // point, so an abort during render, checkout, or the id read lands here.
        if (this.#signal?.aborted) {

            throw new OperationAbortedError('Run cancelled before the file started');

        }

        this.#active = statement;
        statement.timer = setTimeout(() => void this.#report(statement), this.#delayMs);

        try {

            return await fn(conn);

        }
        finally {

            clearTimeout(statement.timer);
            this.#active = null;
            statement.finished = true;

            // A cancel still in flight would otherwise land on this session
            // after the pool hands it to the runner's next tracking query.
            await statement.cancelling;

        }

    }

    async #readSessionId(conn: Kysely<DB>): Promise<number | null> {

        const query = this.#dialect ? SESSION_ID_SQL[this.#dialect] : undefined;

        if (!query) return null;

        const [result, err] = await attempt(() => sql.raw<{ id?: unknown }>(query).execute(conn));

        if (err) return null;

        return readSessionId(result.rows) ?? null;

    }

    async #report(statement: WatchedStatement): Promise<void> {

        if (this.#active !== statement) return;

        const status = await this.#poll(statement);

        if (this.#active !== statement) return;

        observer.emit('file:progress', {
            filepath: statement.filepath,
            elapsedMs: performance.now() - statement.startedAt,
            sessionId: statement.sessionId,
            status,
        });

        statement.timer = setTimeout(() => void this.#report(statement), this.#intervalMs);

    }

    async #poll(statement: WatchedStatement): Promise<StatementStatus | null> {

        const probe = this.#dialect ? STATEMENT_PROBES[this.#dialect] : undefined;
        const sessionId = statement.sessionId;

        if (!probe || sessionId === null) return null;

        const side = await this.#sideConnection();

        if (!side) return null;

        const [status, err] = await attempt(() => probe(side, sessionId));

        return err ? null : status;

    }

    async #cancel(statement: WatchedStatement): Promise<void> {

        const cancel = this.#dialect ? SERVER_CANCEL[this.#dialect] : undefined;
        const sessionId = statement.sessionId;

        if (sessionId === null || !cancel) return;

        const side = await this.#sideConnection();

        if (statement.finished || this.#closed) return;

        if (!side) {

            observer.emit('error', {
                source: 'runner:cancel',
                error: new Error('No free connection to send the cancel from'),
                context: { filepath: statement.filepath, sessionId },
            });

            return;

        }

        // Only the send is awaited by #watch: waiting on the checkout too would
        // hold the pinned connection a pool with no spare one needs to serve it.
        const sending = attempt(() => cancel(side, sessionId));
        statement.cancelling = sending.then(() => undefined);

        const [, err] = await sending;

        if (err) {

            observer.emit('error', {
                source: 'runner:cancel',
                error: err,
                context: { filepath: statement.filepath, sessionId },
            });

        }

    }

    async #sideConnection(): Promise<Kysely<DB> | null> {

        if (this.#closed || this.#sideAbandoned) return null;

        this.#side ??= this.#checkoutSide();

        const pending = this.#side;
        const [side] = await attempt(() => runWithTimeout(() => pending, { timeout: SIDE_CONNECTION_WAIT_MS }));

        // A checkout handed back for having no statement to watch resets
        // `#side`; only a timeout or a failed checkout leaves it in place.
        if (!side && this.#side === pending) this.#sideAbandoned = true;

        return side ?? null;

    }

    /**
     * Check a connection out of the pool and hold it until `close()`.
     *
     * Kysely only lends a dedicated connection for the duration of a callback,
     * so the callback parks on a promise that `close()` resolves. A checkout
     * that arrives after the watcher gave up on it returns at once.
     */
    #checkoutSide(): Promise<Kysely<DB> | null> {

        return new Promise((resolveSide) => {

            const released = new Promise<void>((release) => {

                this.#releaseSide = release;

            });

            this.#sideHeld = attempt(() => this.#pool.connection().execute(async (side) => {

                if (this.#sideAbandoned || this.#closed) return;

                // With no spare connection in the pool, this checkout is only
                // served by the file releasing its own, so it arrives with no
                // statement running. Holding it then would starve the runner's
                // tracking queries; hand it back and let the next slow file retry.
                if (this.#active === null) {

                    this.#side = null;
                    resolveSide(null);

                    return;

                }

                resolveSide(side);

                await released;

            })).then(([, err]) => {

                if (err) {

                    resolveSide(null);

                    observer.emit('error', {
                        source: 'runner:watch',
                        error: err,
                        context: { operation: 'side-connection' },
                    });

                }

            });

        });

    }

}
