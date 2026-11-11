/**
 * The integration suite produces every failure it can for real. These cover
 * transport failures a container cannot produce on demand, and two contracts:
 * an error with nothing to add comes back untouched, and a reworded one still
 * carries the driver's error.
 */
import { describe, it, expect } from 'bun:test';

import { DatabaseConnectionError, explainConnectionError } from '../../../src/core/connection/errors.js';
import { SslFileError } from '../../../src/core/connection/ssl-files.js';
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

    it('should return an SslFileError unchanged', () => {

        const err = new SslFileError('ssl.caFile', '/certs/ca.pem', 'ENOENT');

        expect(explainConnectionError(err, config)).toBe(err);

    });

    it('should name ssl.caFile as the way to trust a private authority', () => {

        const explained = explainConnectionError(networkError('SELF_SIGNED_CERT_IN_CHAIN'), config);

        expect(explained.message).toContain('ssl.caFile');
        expect(explained.message).toContain(
            'Trust the authority that issued it with ssl.caFile (or process-wide with NODE_EXTRA_CA_CERTS). Otherwise, ',
        );
        expect(explained.message).not.toContain('on this machine');

    });

    it.each<[ConnectionConfig['dialect'], number]>([
        ['postgres', 5432],
        ['mysql', 3306],
        ['mssql', 1433],
    ])('should name ssl.caFile and ssl.rejectUnauthorized: false on %s', (dialect, port) => {

        const explained = explainConnectionError(networkError('SELF_SIGNED_CERT_IN_CHAIN'), { ...config, dialect, port });

        expect(explained.message).toContain('ssl.caFile');
        expect(explained.message).toContain(
            'Otherwise, set ssl.rejectUnauthorized: false to keep encryption without validating the certificate.',
        );

    });

    it.each<[ConnectionConfig['dialect'], number]>([
        ['postgres', 5432],
        ['mysql', 3306],
    ])('should say to remove tlsServerName too on %s when one is set', (dialect, port) => {

        const explained = explainConnectionError(
            networkError('SELF_SIGNED_CERT_IN_CHAIN'),
            { ...config, dialect, port, tlsServerName: 'db.internal' },
        );

        expect(explained.message).toContain('remove tlsServerName');
        expect(explained.message).toContain('ssl.rejectUnauthorized: false');

    });

    it('should not mention tlsServerName when none is set', () => {

        const explained = explainConnectionError(networkError('SELF_SIGNED_CERT_IN_CHAIN'), config);

        expect(explained.message).not.toContain('tlsServerName');

    });

    it('should not tell MSSQL to remove tlsServerName', () => {

        const explained = explainConnectionError(
            networkError('SELF_SIGNED_CERT_IN_CHAIN'),
            { ...config, dialect: 'mssql', port: 1433, tlsServerName: 'localhost' },
        );

        expect(explained.message).not.toContain('tlsServerName');

    });

    it.each([
        'self-signed certificate',
        'self signed certificate',
        'self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca',
    ])('should map the depth-zero self-signed message "%s" to DEPTH_ZERO_SELF_SIGNED_CERT', (message) => {

        const rejected = Object.assign(new Error(message), { code: 'HANDSHAKE_SSL_ERROR' });
        const explained = explainConnectionError(rejected, { ...config, dialect: 'mysql', port: 3306 });

        expect(explained.message).toContain('(DEPTH_ZERO_SELF_SIGNED_CERT)');

    });

    it('should give a hostname mismatch its own hint with no certificate-authority advice', () => {

        const explained = explainConnectionError(networkError('ERR_TLS_CERT_ALTNAME_INVALID'), config);

        expect(explained.message).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
        expect(explained.message).toContain('different hostname');
        expect(explained.message).toContain('tlsServerName');
        expect(explained.message).not.toContain('ssl.caFile');

    });

    it('should give a mysql2 certificate rejection the certificate hint', () => {

        const rejected = Object.assign(new Error('self signed certificate in certificate chain'), { code: 'HANDSHAKE_SSL_ERROR' });
        const explained = explainConnectionError(rejected, { ...config, dialect: 'mysql', port: 3306 });

        expect(explained.message).toContain('The server\'s TLS certificate was rejected (SELF_SIGNED_CERT_IN_CHAIN)');
        expect(explained.message).toContain('ssl.caFile');
        expect(explained.message).toContain('NODE_EXTRA_CA_CERTS');

    });

    it('should give a mysql2 hostname mismatch the hostname hint', () => {

        const mismatch = Object.assign(
            new Error('Hostname/IP does not match certificate\'s altnames: IP: 127.0.0.1 is not in the cert\'s list: '),
            { code: 'HANDSHAKE_SSL_ERROR' },
        );
        const explained = explainConnectionError(mismatch, { ...config, dialect: 'mysql', port: 3306 });

        expect(explained.message).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
        expect(explained.message).toContain('tlsServerName');
        expect(explained.message).not.toContain('ssl.caFile');

    });

    it('should name the certificate hostname from a mysql2 mismatch message without the redundant prefix', () => {

        const mismatch = Object.assign(
            new Error('Hostname/IP does not match certificate\'s altnames: Host: wrong.example. is not cert\'s CN: srv'),
            { code: 'HANDSHAKE_SSL_ERROR' },
        );
        const explained = explainConnectionError(mismatch, { ...config, dialect: 'mysql', port: 3306 });

        expect(explained.message).toContain(
            '(ERR_TLS_CERT_ALTNAME_INVALID: Host: wrong.example. is not cert\'s CN: srv). Set tlsServerName',
        );
        expect(explained.message).not.toContain('Hostname/IP does not match');

    });

    it('should name the certificate hostname from a direct-code pg-style error', () => {

        const mismatch = Object.assign(
            new Error('Hostname/IP does not match certificate\'s altnames: IP: 127.0.0.1 is not in the cert\'s list: srv'),
            { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
        );
        const explained = explainConnectionError(mismatch, config);

        expect(explained.message).toContain('(ERR_TLS_CERT_ALTNAME_INVALID: IP: 127.0.0.1 is not in the cert\'s list: srv)');

    });

    it('should name the certificate hostname from a tedious-style error whose socket error sits in cause', () => {

        const socket = Object.assign(
            new Error('Hostname/IP does not match certificate\'s altnames: Host: wrong.example. is not cert\'s CN: srv'),
            { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
        );
        const wrapped = new Error('Failed to connect to db.example.com:1433 - Client network socket disconnected', { cause: socket });
        const explained = explainConnectionError(wrapped, { ...config, dialect: 'mssql', port: 1433 });

        expect(explained.message).toContain('(ERR_TLS_CERT_ALTNAME_INVALID: Host: wrong.example. is not cert\'s CN: srv)');

    });

    it('should fall back to the code alone when the mismatch carries no reason text', () => {

        const mismatch = Object.assign(new Error('Hostname/IP does not match certificate\'s altnames: '), {
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
        const explained = explainConnectionError(mismatch, config);

        expect(explained.message).toContain('different hostname (ERR_TLS_CERT_ALTNAME_INVALID). Set tlsServerName');

    });

    it('should drop the trailing colon when the name list is empty', () => {

        const mismatch = Object.assign(
            new Error('Hostname/IP does not match certificate\'s altnames: IP: 127.0.0.1 is not in the cert\'s list: '),
            { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
        );
        const explained = explainConnectionError(mismatch, config);

        expect(explained.message).toContain('(ERR_TLS_CERT_ALTNAME_INVALID: IP: 127.0.0.1 is not in the cert\'s list). Set tlsServerName');

    });

    it('should cut a long name list at 300 characters and end it with an ellipsis', () => {

        const names = Array.from({ length: 80 }, (_, index) => `host${index}.example`).join(', ');
        const mismatch = Object.assign(new Error(`Hostname/IP does not match certificate's altnames: ${names}`), {
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
        const explained = explainConnectionError(mismatch, config);
        const reason = /\(ERR_TLS_CERT_ALTNAME_INVALID: (.*)\)\. Set tlsServerName/.exec(explained.message)?.[1];

        expect(reason).toBeDefined();
        expect(reason).toHaveLength(300);
        expect(reason?.endsWith('...')).toBe(true);
        expect(names.startsWith(reason?.slice(0, -3) ?? '?')).toBe(true);

    });

    it('should return promptly for a reason with a long whitespace run in the middle', () => {

        const mismatch = Object.assign(new Error(`Hostname/IP does not match certificate's altnames: a${' '.repeat(20000)}b`), {
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
        const started = performance.now();
        const explained = explainConnectionError(mismatch, config);
        const elapsed = performance.now() - started;
        const reason = /\(ERR_TLS_CERT_ALTNAME_INVALID: (.*)\)\. Set tlsServerName/s.exec(explained.message)?.[1];

        expect(elapsed).toBeLessThan(1000);
        expect(reason).toHaveLength(300);

    });

    it('should not split a surrogate pair when it cuts a long name list', () => {

        const mismatch = Object.assign(new Error(`Hostname/IP does not match certificate's altnames: ${'\u{1F600}'.repeat(400)}`), {
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
        const explained = explainConnectionError(mismatch, config);
        const reason = /\(ERR_TLS_CERT_ALTNAME_INVALID: (.*)\)\. Set tlsServerName/s.exec(explained.message)?.[1] ?? '';

        expect(reason.endsWith('...')).toBe(true);
        expect(reason.slice(0, -3).isWellFormed()).toBe(true);
        expect([...reason]).toHaveLength(300);

    });

    it('should not give another mysql2 TLS failure the certificate hint', () => {

        const failed = Object.assign(new Error('write EPROTO: no protocols available'), { code: 'HANDSHAKE_SSL_ERROR' });
        const explained = explainConnectionError(failed, { ...config, dialect: 'mysql', port: 3306 });

        expect(explained.message).not.toContain('ssl.caFile');
        expect(explained.message).toContain('no protocols available');

    });

    it.each([
        'tlsv1 alert unknown ca',
        'error:0A00010B:SSL routines::wrong version number',
    ])('should not give a mysql2 "%s" failure the certificate hint', (message) => {

        const failed = Object.assign(new Error(message), { code: 'HANDSHAKE_SSL_ERROR' });
        const explained = explainConnectionError(failed, { ...config, dialect: 'mysql', port: 3306 });

        expect(explained.message).not.toContain('ssl.caFile');

    });

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
