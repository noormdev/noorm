/**
 * The integration suite produces every failure it can for real. These cover
 * transport failures a container cannot produce on demand, and two contracts:
 * an error with nothing to add comes back untouched, and a reworded one still
 * carries the driver's error.
 */
import { describe, it, expect } from 'bun:test';

import { DatabaseConnectionError, explainConnectionError } from '../../../src/core/connection/errors.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';


const config: ConnectionConfig = {
    dialect: 'postgres',
    host: 'db.example.com',
    port: 5432,
    database: 'app_test',
    user: 'app',
    connectTimeoutMs: 2_000,
};

/** A driver error with a Node network code, the way pg and mysql2 raise them. */
function networkError(code: string): Error {

    return Object.assign(new Error(`connect ${code}`), { code });

}


describe('connection: explainConnectionError', () => {

    it('should name a connection that timed out, with the timeout that applied', () => {

        const explained = explainConnectionError(networkError('ETIMEDOUT'), config);

        expect(explained.message).toContain('db.example.com:5432 did not answer within 2000ms');

    });

    it('should read tedious\'s own timeout code the same way', () => {

        const explained = explainConnectionError(networkError('ETIMEOUT'), { ...config, dialect: 'mssql', port: 1433 });

        expect(explained.message).toContain('db.example.com:1433 did not answer');

    });

    it('should name a host with no network route to it', () => {

        const explained = explainConnectionError(networkError('EHOSTUNREACH'), config);

        expect(explained.message).toContain('db.example.com is unreachable from this machine');

    });

    it('should name a handshake the server cut off', () => {

        const explained = explainConnectionError(networkError('ECONNRESET'), config);

        expect(explained.message).toContain('closed the connection during the handshake');

    });

    it('should find a code wrapped in cause and in an AggregateError', () => {

        const refused = new AggregateError([networkError('ECONNREFUSED')], '');
        const wrapped = new Error('Failed to connect - Could not connect (sequence)', { cause: refused });

        const explained = explainConnectionError(wrapped, config);

        expect(explained.message).toContain('Connection refused at db.example.com:5432');

    });

    it('should keep the driver\'s error as the cause, so its code stays reachable', () => {

        const original = networkError('ECONNREFUSED');

        expect(explainConnectionError(original, config).cause).toBe(original);

    });

    it('should return an error with no code and nothing to explain unchanged, so noorm\'s own errors keep their type', () => {

        const original = new Error('Operation aborted');

        expect(explainConnectionError(original, config)).toBe(original);

    });

    it('should keep the driver\'s wording for a code it has no reason for, and still log the code', () => {

        const original = Object.assign(new Error('protocol violation'), { code: '08P01' });

        const explained = explainConnectionError(original, config);

        expect(explained.message).toBe('protocol violation');
        expect(explained).toBeInstanceOf(DatabaseConnectionError);
        expect(explained instanceof DatabaseConnectionError && explained.serverCode).toBe('08P01');

    });

    it('should log every message along the chain, since the outer one is often empty', () => {

        const refused = new AggregateError([networkError('ECONNREFUSED')], '');

        const explained = explainConnectionError(refused, config);

        expect(explained instanceof DatabaseConnectionError && explained.serverMessage).toBe('connect ECONNREFUSED');

    });

});
