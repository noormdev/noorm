/**
 * Lock contention worker — one OS process, one acquire attempt.
 *
 * Spawned by `contention.test.ts`. Real contention needs real processes: a
 * single process cannot interleave two `acquire()` calls at the SELECT→INSERT
 * boundary, which is exactly where the race lives. Workers synchronise on a
 * shared wall-clock start time so their attempts overlap.
 *
 * Emits one JSON line on stdout describing the outcome.
 *
 * Usage: bun race-worker.ts <configName> <identity> <startMs> <dialect> [timeoutMs] [waitTimeoutMs]
 */
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import { getLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import { TEST_CONNECTIONS } from '../../utils/db.js';

const [configName, identity, startMs, dialectArg, timeoutMs, waitTimeoutMs] = process.argv.slice(2);

const dialect = dialectArg as Dialect;
const shouldWait = waitTimeoutMs !== undefined;

const conn = await createConnection(TEST_CONNECTIONS[dialect], `__race_${identity}__`);
const db = conn.db as Kysely<NoormDatabase>;
const manager = getLockManager();

// Warm the pool so the barrier releases into a live connection, not a handshake.
await attempt(() => manager.status(db, `${configName}__warmup`, dialect));

const start = Number(startMs);
while (Date.now() < start) await Bun.sleep(1);

const began = Date.now();

const [lock, err] = await attempt(() =>
    manager.acquire(db, configName!, identity!, {
        dialect,
        timeout: timeoutMs ? Number(timeoutMs) : 60_000,
        wait: shouldWait,
        ...(shouldWait ? { waitTimeout: Number(waitTimeoutMs), pollInterval: 100 } : {}),
    }),
);

const elapsed = Date.now() - began;

// `code` is what a raw driver error carries (postgres 23505, mysql ER_DUP_ENTRY).
// Reporting it is how the test tells a domain error from a leaked driver error.
const driverCode = err ? (err as unknown as { code?: string | number }).code : undefined;

console.log(JSON.stringify({
    identity,
    outcome: err ? 'THREW' : 'ACQUIRED',
    elapsed,
    lockedBy: lock?.lockedBy ?? null,
    errorName: err?.name ?? null,
    errorMessage: err?.message ?? null,
    holder: err ? (err as unknown as { holder?: string }).holder ?? null : null,
    driverCode: driverCode ?? null,
}));

await conn.destroy();
