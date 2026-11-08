import { describe, expect, it } from 'bun:test';
import { createPostgresConnection } from '../../src/core/connection/dialects/postgres.js';

describe('PostgreSQL TLS identity options', () => {

    const config = { dialect: 'postgres' as const, host: '127.0.0.1', database: 'app', tlsServerName: 'db.example.test' };
    it('rejects a name without explicitly enabled TLS', async () => {

        await expect(createPostgresConnection(config)).rejects.toThrow('require ssl');
        await expect(createPostgresConnection({ ...config, ssl: false })).rejects.toThrow('require ssl');

    });
    it('rejects identity options with verification disabled', async () => {

        await expect(createPostgresConnection({ ...config, ssl: { rejectUnauthorized: false } })).rejects.toThrow('require certificate verification');

    });

});
