/**
 * bun:test preload — runs once per test process.
 *
 * Responsibilities:
 *   - Eagerly build the shared SDK context so the first test file doesn't
 *     pay for schema installation inside its own timeout budget.
 *   - Register an `afterAll` hook at the process level to disconnect the
 *     Kysely pool. Without this, bun hangs after the last test because the
 *     pool keeps sockets alive.
 */
import { afterAll, beforeAll } from 'bun:test';

import { disposeSharedContext, getSharedContext } from './_helpers/setup.js';

beforeAll(async () => {

    await getSharedContext();

});

afterAll(async () => {

    await disposeSharedContext();

});
