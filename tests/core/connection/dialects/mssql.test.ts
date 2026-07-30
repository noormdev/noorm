/**
 * Unit tests for the MSSQL tedious option builder.
 *
 * These exist because connecting to MSSQL by IP address was broken outright:
 * tedious derives the TLS SNI ServerName from `server`, and Node's TLS layer
 * rejects an IP literal there (RFC 6066). The assertions below encode the
 * intended security posture per case, not merely the shape of the object —
 * an IP host must keep encryption on when certificates are not being
 * validated, and must refuse to connect (never silently downgrade) when they
 * are.
 */
import { describe, it, expect } from 'bun:test';
import { isIP } from 'node:net';

import { attemptSync } from '@logosdx/utils';

import { ConnectionSchema } from '../../../../src/core/config/schema.js';
import {
    MssqlTlsServerNameError,
    UNVERIFIED_TLS_SERVER_NAME,
    buildTediousOptions,
    resolveTlsServerName,
} from '../../../../src/core/connection/dialects/mssql.js';
import type { ConnectionConfig } from '../../../../src/core/connection/types.js';


/**
 * Build an mssql ConnectionConfig with only the fields under test varying.
 */
function mssqlConfig(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {

    return {
        dialect: 'mssql',
        host: 'db.example.com',
        port: 11433,
        user: 'sa',
        password: 'secret',
        database: 'app',
        ...overrides,
    };

}


describe('connection/dialects/mssql: resolveTlsServerName', () => {

    it('should leave hostname connections untouched', () => {

        expect(resolveTlsServerName(mssqlConfig())).toBeUndefined();

    });

    it('should leave hostname connections untouched when validating certificates', () => {

        expect(resolveTlsServerName(mssqlConfig({ ssl: true }))).toBeUndefined();

    });

    it('should leave an unset host untouched', () => {

        expect(resolveTlsServerName(mssqlConfig({ host: undefined }))).toBeUndefined();

    });

    it('should substitute a placeholder for an IPv4 host when not validating certificates', () => {

        expect(resolveTlsServerName(mssqlConfig({ host: '46.101.71.200' })))
            .toBe(UNVERIFIED_TLS_SERVER_NAME);

    });

    it('should substitute a placeholder for an IPv6 host when not validating certificates', () => {

        expect(resolveTlsServerName(mssqlConfig({ host: '2001:db8::1' })))
            .toBe(UNVERIFIED_TLS_SERVER_NAME);

    });

    it('should never substitute a placeholder that is itself an IP literal', () => {

        // The placeholder only works because Node accepts it as a DNS name;
        // an IP literal would reintroduce the exact bug this guards against.
        expect(isIP(UNVERIFIED_TLS_SERVER_NAME)).toBe(0);

    });

    it('should prefer a supplied certificate hostname over the placeholder', () => {

        expect(resolveTlsServerName(mssqlConfig({ host: '46.101.71.200', tlsServerName: 'sql.example.com' })))
            .toBe('sql.example.com');

    });

    it('should use the supplied certificate hostname when validating certificates', () => {

        expect(resolveTlsServerName(mssqlConfig({ host: '46.101.71.200', ssl: true, tlsServerName: 'sql.example.com' })))
            .toBe('sql.example.com');

    });

    it('should honour a supplied certificate hostname for a hostname connection', () => {

        expect(resolveTlsServerName(mssqlConfig({ tlsServerName: 'sql.internal' })))
            .toBe('sql.internal');

    });

    it('should refuse to connect to an IP while validating certificates without a hostname', () => {

        const [result, err] = attemptSync(() =>
            resolveTlsServerName(mssqlConfig({ host: '46.101.71.200', ssl: true })),
        );

        expect(result).toBeNull();
        expect(err).toBeInstanceOf(MssqlTlsServerNameError);
        expect(err?.message).toContain('tlsServerName');
        expect(err?.message).toContain('46.101.71.200');

    });

    it('should reject an IP address supplied as the certificate hostname', () => {

        const [, err] = attemptSync(() =>
            resolveTlsServerName(mssqlConfig({ host: '46.101.71.200', tlsServerName: '46.101.71.200' })),
        );

        expect(err).toBeInstanceOf(MssqlTlsServerNameError);
        expect(err?.message).toContain('tlsServerName');

    });

});


describe('connection/dialects/mssql: buildTediousOptions', () => {

    it('should keep encryption on and omit serverName for a hostname', () => {

        const options = buildTediousOptions(mssqlConfig());

        expect(options.server).toBe('db.example.com');
        expect(options.options?.encrypt).toBe(true);
        expect(options.options?.serverName).toBeUndefined();

    });

    it('should keep encryption on for an IP host rather than downgrading', () => {

        const options = buildTediousOptions(mssqlConfig({ host: '46.101.71.200' }));

        expect(options.server).toBe('46.101.71.200');
        expect(options.options?.encrypt).toBe(true);
        expect(options.options?.trustServerCertificate).toBe(true);
        expect(options.options?.serverName).toBe(UNVERIFIED_TLS_SERVER_NAME);

    });

    it('should validate certificates against the supplied hostname for an IP host', () => {

        const options = buildTediousOptions(mssqlConfig({ host: '46.101.71.200', ssl: true, tlsServerName: 'sql.example.com' }));

        expect(options.options?.encrypt).toBe(true);
        expect(options.options?.trustServerCertificate).toBe(false);
        expect(options.options?.serverName).toBe('sql.example.com');

    });

    it('should carry the database override used by the master preflight', () => {

        const options = buildTediousOptions(mssqlConfig({ host: '10.0.0.5' }), 'master');

        expect(options.options?.database).toBe('master');
        expect(options.options?.serverName).toBe(UNVERIFIED_TLS_SERVER_NAME);

    });

    it('should default the host to localhost', () => {

        const options = buildTediousOptions(mssqlConfig({ host: undefined }));

        expect(options.server).toBe('localhost');
        expect(options.options?.serverName).toBeUndefined();

    });

    it('should survive config validation rather than being stripped', () => {

        // Zod drops unrecognized keys silently, so a field missing from
        // ConnectionSchema would never reach this builder at all.
        const parsed = ConnectionSchema.parse(mssqlConfig({ host: '10.0.0.5', tlsServerName: 'sql.example.com' }));

        expect(buildTediousOptions(parsed).options?.serverName).toBe('sql.example.com');

    });

});
