/**
 * Integration: differential test for the SQL statement classifier.
 *
 * `classifyStatements` is ~800 lines of hand-rolled parsing whose entire job
 * is to predict what a database will do, and it was validated exclusively
 * against hand-written expectations. Every classifier bypass found in the v1
 * audit — `EXPLAIN (ANALYZE) DELETE`, `EXPLAIN ANALYZE CREATE TABLE ... AS`,
 * the MSSQL bracket-identifier statement split — came from *running* the
 * statement and diffing the database, and none from reading the code.
 *
 * So this asks the database instead of a table of expectations. For each
 * probe it records the observable state, executes the statement ungated,
 * records the state again, and asserts the one invariant the access gate
 * actually depends on:
 *
 *     if the statement changed anything, it did not classify `read`.
 *
 * Deliberately one-sided. Over-classification is a usability problem;
 * under-classification is a `viewer` role deleting production rows, which is
 * what shipped. A probe the server rejects is reported inert and excluded
 * rather than failed — a dialect refusing a form is a different fact from
 * the classifier misreading one.
 *
 * Two guards keep the invariant from passing vacuously: at least one probe
 * per dialect must have really changed the database, and the plain-SELECT
 * baseline must still classify `read` (otherwise a classifier that answered
 * `ddl` to everything would satisfy the invariant while being useless).
 *
 * `executeRawSqlUnchecked` is used on purpose: gating here would test the
 * gate, and the gate is not what was broken.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { classifyStatements } from '../../../src/core/policy/index.js';
import { executeRawSqlUnchecked } from '../../../src/core/sql-terminal/executor.js';
import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';
import type { Dialect } from '../../../src/core/connection/types.js';

/** Table the probes read and write; recreated before every probe. */
const PROBE_TABLE = 'clsdiff_rows';

/** Table no probe may create unless it classified above `read`. */
const CREATED_TABLE = 'clsdiff_created';

/** The baseline read, asserted separately so the invariant cannot pass vacuously. */
const BASELINE_READ = `SELECT id FROM ${PROBE_TABLE}`;

interface Probe {
    /** Statement handed to both the classifier and the database. */
    sql: string;
    /** Why this form is worth executing rather than merely asserting. */
    why: string;
}

/** Probes every dialect gets. */
const SHARED_PROBES: Probe[] = [
    { sql: `DELETE FROM ${PROBE_TABLE}`, why: 'an obvious write must be caught' },
    { sql: `${BASELINE_READ}; DELETE FROM ${PROBE_TABLE}`, why: 'a second statement must not hide behind the first' },
    { sql: `SELECT 'a;b' AS x FROM ${PROBE_TABLE}`, why: 'a semicolon in a string literal is not a statement boundary' },
];

/**
 * The EXPLAIN family, where the gate was walked past. Postgres executes the
 * plan under ANALYZE; other dialects mostly reject these forms and are then
 * excluded as inert.
 */
const EXPLAIN_PROBES: Probe[] = [
    { sql: `EXPLAIN ANALYZE DELETE FROM ${PROBE_TABLE}`, why: 'the bare ANALYZE form the CST parser accepts' },
    { sql: `EXPLAIN (ANALYZE) DELETE FROM ${PROBE_TABLE}`, why: 'the parenthesised form the postgres docs lead with, which the parser rejects' },
    { sql: `EXPLAIN (ANALYZE, BUFFERS) DELETE FROM ${PROBE_TABLE}`, why: 'multiple options must not change the verdict' },
    { sql: `EXPLAIN ANALYZE VERBOSE DELETE FROM ${PROBE_TABLE}`, why: 'stacked bare options must not change the verdict' },
    { sql: `explain (analyze) delete from ${PROBE_TABLE}`, why: 'SQL keywords are case-insensitive' },
    { sql: `EXPLAIN ANALYZE UPDATE ${PROBE_TABLE} SET id = id + 100`, why: 'UPDATE under EXPLAIN ANALYZE updates for real' },
    { sql: `EXPLAIN ANALYZE CREATE TABLE ${CREATED_TABLE} AS SELECT 1 AS a`, why: 'DDL under EXPLAIN ANALYZE creates for real' },
];

const POSTGRES_PROBES: Probe[] = [
    { sql: `WITH t AS (DELETE FROM ${PROBE_TABLE} RETURNING id) SELECT * FROM t`, why: 'the CTE body deletes while the statement returns rows' },
    { sql: `SELECT id INTO ${CREATED_TABLE} FROM ${PROBE_TABLE}`, why: 'SELECT INTO creates a table' },
];

const MSSQL_PROBES: Probe[] = [
    { sql: `SELECT 1 AS [a'b]; DELETE FROM ${PROBE_TABLE}`, why: 'an apostrophe in a bracket identifier must not swallow the next statement' },
    { sql: `SELECT id AS [a;b] FROM ${PROBE_TABLE}`, why: 'a semicolon in a bracket identifier is not a statement boundary' },
    { sql: `SELECT id INTO ${CREATED_TABLE} FROM ${PROBE_TABLE}`, why: 'SELECT INTO creates a table on mssql too' },
];

const MYSQL_PROBES: Probe[] = [
    { sql: `SELECT 1 AS \`a'b\`; DELETE FROM ${PROBE_TABLE}`, why: 'an apostrophe in a backtick identifier must not swallow the next statement' },
];

/** Observable state a probe could have changed. */
interface Snapshot {
    rows: number;
    createdTableExists: boolean;
}

/** Result of running one probe against a live database. */
interface Observation {
    probe: Probe;
    classified: string;
    /** False when the server rejected the statement — the form is unsupported here. */
    executed: boolean;
    changed: boolean;
}

/** Drops and recreates the probe fixtures so every probe starts identical. */
async function reset(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    await attempt(() => sql.raw(`DROP TABLE ${CREATED_TABLE}`).execute(db));
    await attempt(() => sql.raw(`DROP TABLE ${PROBE_TABLE}`).execute(db));

    const idType = dialect === 'mssql' ? 'INT' : 'INTEGER';

    await sql.raw(`CREATE TABLE ${PROBE_TABLE} (id ${idType} NOT NULL)`).execute(db);
    await sql.raw(`INSERT INTO ${PROBE_TABLE} (id) VALUES (1), (2), (3)`).execute(db);

}

/** Reads the observable state the probes can move. */
async function snapshot(db: Kysely<unknown>, dialect: Dialect): Promise<Snapshot> {

    const [counted] = await attempt(() => sql.raw(`SELECT COUNT(*) AS n FROM ${PROBE_TABLE}`).execute(db));
    const probed = await attempt(() => sql.raw(
        `SELECT ${dialect === 'mssql' ? 'TOP 1 1 AS one' : '1 AS one'} FROM ${CREATED_TABLE}`,
    ).execute(db));

    return {
        rows: Number((counted?.rows[0] as { n?: unknown } | undefined)?.n ?? -1),
        createdTableExists: probed[1] === undefined,
    };

}

/** Classifies a probe, executes it for real, and reports what moved. */
async function observe(db: Kysely<unknown>, dialect: Dialect, probe: Probe): Promise<Observation> {

    await reset(db, dialect);

    const before = await snapshot(db, dialect);
    const classified = classifyStatements(probe.sql, dialect);
    const result = await executeRawSqlUnchecked(db, probe.sql, 'classifier-differential');
    const after = await snapshot(db, dialect);

    return {
        probe,
        classified,
        executed: result.success,
        changed: before.rows !== after.rows || before.createdTableExists !== after.createdTableExists,
    };

}

/** Registers the differential suite for one dialect. */
function differentialSuite(dialect: Dialect, probes: Probe[]): void {

    describe(`integration: ${dialect} classifier differential`, () => {

        let db: Kysely<unknown>;
        let destroy: () => Promise<void>;

        beforeAll(async () => {

            await skipIfNoContainer(dialect);

            const conn = await createTestConnection(dialect);

            db = conn.db;
            destroy = conn.destroy;

        });

        afterAll(async () => {

            if (!db) return;

            await attempt(() => sql.raw(`DROP TABLE ${CREATED_TABLE}`).execute(db));
            await attempt(() => sql.raw(`DROP TABLE ${PROBE_TABLE}`).execute(db));
            await destroy();

        });

        it('should never classify as read a statement that changed the database', async () => {

            const observations: Observation[] = [];

            for (const probe of probes) {

                observations.push(await observe(db, dialect, probe));

            }

            const effective = observations.filter((o) => o.executed && o.changed);

            // Guard: without this, a dialect that rejected every probe would pass silently.
            expect(effective.length).toBeGreaterThan(0);

            const underClassified = effective
                .filter((o) => o.classified === 'read')
                .map((o) => `${o.probe.sql}  (${o.probe.why})`);

            expect(underClassified).toEqual([]);

        });

        it('should still classify a plain SELECT as read', async () => {

            const observation = await observe(db, dialect, { sql: BASELINE_READ, why: 'baseline' });

            expect(observation.executed).toBe(true);
            expect(observation.changed).toBe(false);
            expect(observation.classified).toBe('read');

        });

    });

}

differentialSuite('sqlite', [...SHARED_PROBES, ...EXPLAIN_PROBES]);
differentialSuite('postgres', [...SHARED_PROBES, ...EXPLAIN_PROBES, ...POSTGRES_PROBES]);
differentialSuite('mysql', [...SHARED_PROBES, ...EXPLAIN_PROBES, ...MYSQL_PROBES]);
differentialSuite('mssql', [...SHARED_PROBES, ...MSSQL_PROBES]);
