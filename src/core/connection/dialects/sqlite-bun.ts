/**
 * Bun-native SQLite dialect adapter.
 *
 * Wraps bun:sqlite to match the interface Kysely's SqliteDialect expects.
 * Provides 3-6x faster SQLite operations compared to better-sqlite3
 * by leveraging Bun's built-in SQLite driver.
 */
import { Kysely, SqliteDialect } from 'kysely';
import { Database } from 'bun:sqlite';
import type { ConnectionConfig, ConnectionResult } from '../types.js';

/**
 * Statement wrapper converting Kysely's array args to bun:sqlite's spread args.
 *
 * Kysely's SqliteDialect calls stmt.all(params) with a single ReadonlyArray,
 * while bun:sqlite expects spread arguments: stmt.all(...params).
 */
class BunSqliteStatement {

    #stmt: InstanceType<typeof import('bun:sqlite').Statement>;

    constructor(stmt: InstanceType<typeof import('bun:sqlite').Statement>) {

        this.#stmt = stmt;

    }

    get reader(): boolean {

        return this.#stmt.columnNames.length > 0;

    }

    all(params: ReadonlyArray<unknown>): unknown[] {

        return this.#stmt.all(...params);

    }

    run(params: ReadonlyArray<unknown>): { changes: number | bigint; lastInsertRowid: number | bigint } {

        const result = this.#stmt.run(...params);

        return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
        };

    }

    *iterate(params: ReadonlyArray<unknown>): IterableIterator<unknown> {

        // bun:sqlite doesn't expose iterate, use all() as fallback
        const rows = this.#stmt.all(...params);

        for (const row of rows) {

            yield row;

        }

    }

}

/**
 * Database wrapper matching Kysely's expected SqliteDatabase interface.
 */
class BunSqliteDatabase {

    #db: Database;

    constructor(filename: string) {

        this.#db = new Database(filename);

    }

    close(): void {

        this.#db.close();

    }

    prepare(sql: string): BunSqliteStatement {

        return new BunSqliteStatement(this.#db.prepare(sql));

    }

}

/**
 * Create a SQLite connection using bun:sqlite.
 *
 * Drop-in replacement for createSqliteConnection when running under Bun.
 * Uses Bun's native SQLite driver for significantly faster operations.
 *
 * @example
 * ```typescript
 * const conn = createBunSqliteConnection({ dialect: 'sqlite', database: './data.db' })
 * ```
 */
export function createBunSqliteConnection(config: ConnectionConfig): ConnectionResult {

    const filename = config.filename ?? config.database;

    const db = new Kysely<unknown>({
        dialect: new SqliteDialect({
            database: new BunSqliteDatabase(filename) as never,
        }),
    });

    return {
        db,
        dialect: 'sqlite',
        destroy: () => db.destroy(),
    };

}
