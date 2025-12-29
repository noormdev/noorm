/**
 * SQLite database operations.
 *
 * SQLite databases are just files - no CREATE DATABASE needed.
 */
import { existsSync, unlinkSync } from 'node:fs';
import { attemptSync } from '@logosdx/utils';

import type { ConnectionConfig } from '../../connection/types.js';
import type { DialectDbOperations } from '../types.js';

/**
 * SQLite database operations.
 */
export const sqliteDbOperations: DialectDbOperations = {
    getSystemDatabase(): string | undefined {

        // SQLite doesn't have a system database
        return undefined;

    },

    async databaseExists(config: ConnectionConfig, dbName: string): Promise<boolean> {

        const filename = config.filename ?? dbName;

        // :memory: databases always "exist" when connected
        if (filename === ':memory:') {

            return true;

        }

        return existsSync(filename);

    },

    async createDatabase(_config: ConnectionConfig, _dbName: string): Promise<void> {
        // SQLite creates the file automatically when connecting
        // No explicit CREATE DATABASE needed
    },

    async dropDatabase(config: ConnectionConfig, dbName: string): Promise<void> {

        const filename = config.filename ?? dbName;

        // Can't drop :memory: databases
        if (filename === ':memory:') {

            return;

        }

        if (!existsSync(filename)) {

            return;

        }

        const [, err] = attemptSync(() => unlinkSync(filename));

        if (err) throw err;

    },
};
