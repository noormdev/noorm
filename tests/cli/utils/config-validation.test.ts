import { describe, it, expect } from 'bun:test';

import type { FormValues } from '../../../src/tui/components/index.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';
import {
    buildConnectionConfig,
    buildSslFields,
    sslPinnedByRename,
    validateSslForm,
} from '../../../src/tui/utils/config-validation.js';

const stored: ConnectionConfig = {
    dialect: 'postgres',
    host: 'db.local',
    port: 5432,
    database: 'app',
    user: 'admin',
    password: 'secret',
};

function form(overrides: FormValues = {}): FormValues {

    return {
        host: 'db.local',
        port: '5432',
        database: 'app',
        user: 'admin',
        password: '',
        useSsl: false,
        verifyCertificate: true,
        sslCaFile: '',
        sslCertFile: '',
        sslKeyFile: '',
        tlsServerName: '',
        ...overrides,
    };

}

describe('tui: buildConnectionConfig SSL fields', () => {

    it('should keep every connection field the form does not show', () => {

        const existing: ConnectionConfig = {
            ...stored,
            pool: { max: 20 },
            connectTimeoutMs: 5000,
            applicationName: 'billing',
            keepAlive: true,
            keepAliveInitialDelayMs: 1000,
            ssl: { ca: 'PEM-CA', cert: 'PEM-CERT', rejectUnauthorized: false },
        };

        const result = buildConnectionConfig(form({ host: 'db2.local', useSsl: true, verifyCertificate: false }), 'postgres', existing);

        expect(result).toEqual({ ...existing, host: 'db2.local' });

    });

    it('should keep an absent stored port absent on an edit that leaves the port field empty, so a stage port still applies', () => {

        const { port: _port, ...withoutPort } = stored;

        const result = buildConnectionConfig(form({ port: '' }), 'postgres', withoutPort);

        expect(result.port).toBeUndefined();

    });

    it('should store the dialect default port on the add form when the port field is empty', () => {

        const result = buildConnectionConfig(form({ port: '' }), 'postgres');

        expect(result.port).toBe(5432);

    });

    it('should store ssl true when Use SSL is checked and no path or inline PEM remains', () => {

        const result = buildConnectionConfig(form({ useSsl: true }), 'postgres', stored);

        expect(result.ssl).toBe(true);

    });

    it('should leave ssl absent when Use SSL is unchecked and the stored ssl is absent', () => {

        const edited = buildConnectionConfig(form(), 'postgres', stored);
        const added = buildConnectionConfig(form(), 'postgres');

        expect('ssl' in edited).toBe(false);
        expect('ssl' in added).toBe(false);

    });

    it('should store ssl false when Use SSL is unchecked from a stored truthy ssl', () => {

        const fromTrue = buildConnectionConfig(form(), 'postgres', { ...stored, ssl: true });
        const fromObject = buildConnectionConfig(form(), 'postgres', { ...stored, ssl: { caFile: './ca.pem' } });

        expect(fromTrue.ssl).toBe(false);
        expect(fromObject.ssl).toBe(false);

    });

    it('should store the typed path as written on the add form', () => {

        const result = buildConnectionConfig(
            form({ useSsl: true, sslCaFile: './certs/ca.pem', sslCertFile: '~/c.pem', sslKeyFile: '/etc/k.pem' }),
            'postgres',
        );

        expect(result.ssl).toEqual({ caFile: './certs/ca.pem', certFile: '~/c.pem', keyFile: '/etc/k.pem' });

    });

    it('should remove a stored path when its field is emptied', () => {

        const existing: ConnectionConfig = { ...stored, ssl: { caFile: './ca.pem', certFile: './c.pem', keyFile: './k.pem' } };

        const result = buildConnectionConfig(
            form({ useSsl: true, sslCaFile: './ca.pem', sslCertFile: '', sslKeyFile: './k.pem' }),
            'postgres',
            existing,
        );

        expect(result.ssl).toEqual({ caFile: './ca.pem', keyFile: './k.pem' });

    });

    it('should store ssl true when emptying the last stored path leaves nothing', () => {

        const result = buildConnectionConfig(form({ useSsl: true }), 'postgres', { ...stored, ssl: { caFile: './ca.pem' } });

        expect(result.ssl).toBe(true);

    });

    it('should keep inline PEM when its field is empty', () => {

        const existing: ConnectionConfig = { ...stored, ssl: { ca: 'PEM-CA', key: 'PEM-KEY' } };

        const result = buildConnectionConfig(form({ useSsl: true }), 'postgres', existing);

        expect(result.ssl).toEqual({ ca: 'PEM-CA', key: 'PEM-KEY' });

    });

    it('should replace inline PEM with an entered path for that field only', () => {

        const existing: ConnectionConfig = { ...stored, ssl: { ca: 'PEM-CA', cert: 'PEM-CERT' } };

        const result = buildConnectionConfig(form({ useSsl: true, sslCaFile: './ca.pem' }), 'postgres', existing);

        expect(result.ssl).toEqual({ caFile: './ca.pem', cert: 'PEM-CERT' });

    });

    it('should replace a stored path with a new path', () => {

        const existing: ConnectionConfig = { ...stored, ssl: { caFile: './old.pem' } };

        const result = buildConnectionConfig(form({ useSsl: true, sslCaFile: './new.pem' }), 'postgres', existing);

        expect(result.ssl).toEqual({ caFile: './new.pem' });

    });

    it('should keep rejectUnauthorized while Use SSL stays checked', () => {

        const existing: ConnectionConfig = { ...stored, ssl: { rejectUnauthorized: false } };

        const unverified = { useSsl: true, verifyCertificate: false };
        const unchanged = buildConnectionConfig(form(unverified), 'postgres', existing);
        const withPath = buildConnectionConfig(form({ ...unverified, sslCaFile: './ca.pem' }), 'postgres', existing);

        expect(unchanged.ssl).toEqual({ rejectUnauthorized: false });
        expect(withPath.ssl).toEqual({ rejectUnauthorized: false, caFile: './ca.pem' });

    });

    it('should store a typed TLS server name and remove one that is emptied', () => {

        const set = buildConnectionConfig(form({ useSsl: true, tlsServerName: 'db.corp' }), 'postgres', stored);
        const cleared = buildConnectionConfig(form({ useSsl: true }), 'postgres', { ...stored, ssl: true, tlsServerName: 'db.corp' });

        expect(set.tlsServerName).toBe('db.corp');
        expect('tlsServerName' in cleared).toBe(false);

    });

    it('should keep a stored ssl false when unchecked and make it true when checked', () => {

        const existing: ConnectionConfig = { ...stored, ssl: false };

        expect(buildConnectionConfig(form(), 'postgres', existing).ssl).toBe(false);
        expect(buildConnectionConfig(form({ useSsl: true }), 'postgres', existing).ssl).toBe(true);

    });

    it('should trim both ends of the paths and the TLS server name', () => {

        const result = buildConnectionConfig(
            form({ useSsl: true, sslCaFile: '  ./ca.pem  ', sslKeyFile: '\t./k.pem ', tlsServerName: ' db.corp ' }),
            'postgres',
        );

        expect(result.ssl).toEqual({ caFile: './ca.pem', keyFile: './k.pem' });
        expect(result.tlsServerName).toBe('db.corp');

    });

    it('should treat a whitespace-only path as empty and keep inline PEM', () => {

        const existing: ConnectionConfig = { ...stored, ssl: { ca: 'PEM-CA' }, tlsServerName: 'db.corp' };

        const result = buildConnectionConfig(form({ useSsl: true, sslCaFile: '   ', tlsServerName: '  ' }), 'postgres', existing);

        expect(result.ssl).toEqual({ ca: 'PEM-CA' });
        expect('tlsServerName' in result).toBe(false);

    });

    it('should drop a stored SQLite filename so the Database field decides the file', () => {

        const existing: ConnectionConfig = { dialect: 'sqlite', database: './old.db', filename: './old.db' };

        const result = buildConnectionConfig({ database: './new.db' }, 'sqlite', existing);

        expect(result).toEqual({ dialect: 'sqlite', database: './new.db' });

    });

    it('should ignore the SSL fields for SQLite', () => {

        const result = buildConnectionConfig(
            { database: './app.db', useSsl: true, sslCaFile: './ca.pem', tlsServerName: 'db.corp' },
            'sqlite',
        );

        expect(result).toEqual({ dialect: 'sqlite', database: './app.db' });

    });

});

describe('tui: buildSslFields', () => {

    it('should mark a field whose stored form is inline PEM and leave its value empty', () => {

        const fields = buildSslFields({ ...stored, ssl: { ca: 'PEM-CA', certFile: './c.pem' } });
        const ca = fields.find((f) => f.key === 'sslCaFile');
        const cert = fields.find((f) => f.key === 'sslCertFile');

        expect(ca?.placeholder).toBe('(inline certificate stored)');
        expect(ca?.defaultValue).toBe('');
        expect(cert?.placeholder).toBe('(optional)');
        expect(cert?.defaultValue).toBe('./c.pem');

    });

});

describe('tui: buildConnectionConfig untouched SSL fields', () => {

    const stageCa: ConnectionConfig = { ...stored, ssl: { caFile: './stage-ca.pem' } };
    const underStage = form({ useSsl: true });

    it('should leave an absent ssl and tlsServerName absent under a stage that supplies ssl', () => {

        const result = buildConnectionConfig(form({ ...underStage, host: 'db2.local' }), 'postgres', stored, stageCa);

        expect(result).toEqual({ ...stored, host: 'db2.local' });
        expect('ssl' in result).toBe(false);
        expect('tlsServerName' in result).toBe(false);

    });

    it('should leave a stored ssl and tlsServerName exactly as they were', () => {

        const existing: ConnectionConfig = { ...stored, ssl: true, tlsServerName: ' db.corp ' };
        const effective: ConnectionConfig = { ...existing, ssl: { caFile: './stage-ca.pem' } };

        const result = buildConnectionConfig(form({ ...underStage, tlsServerName: ' db.corp ' }), 'postgres', existing, effective);

        expect(result.ssl).toBe(true);
        expect(result.tlsServerName).toBe(' db.corp ');

    });

    it('should keep the stored tlsServerName when another SSL field changed', () => {

        const existing: ConnectionConfig = { ...stored, ssl: true, tlsServerName: ' db.corp ' };

        const result = buildConnectionConfig(form({ useSsl: true, sslCaFile: './ca.pem', tlsServerName: 'db.corp' }), 'postgres', existing);

        expect(result.ssl).toEqual({ caFile: './ca.pem' });
        expect(result.tlsServerName).toBe(' db.corp ');

    });

    it('should count a whitespace-only difference and a checkbox back in its initial state as untouched', () => {

        const result = buildConnectionConfig(form({ ...underStage, sslCaFile: '   ', tlsServerName: ' ' }), 'postgres', stored, stageCa);

        expect('ssl' in result).toBe(false);
        expect('tlsServerName' in result).toBe(false);

    });

    it('should store nothing for a Verify Certificate change alone under an unchecked, unchanged Use SSL', () => {

        const unverified = form({ verifyCertificate: false });

        expect('ssl' in buildConnectionConfig(unverified, 'postgres', stored)).toBe(false);
        expect('ssl' in buildConnectionConfig(unverified, 'postgres')).toBe(false);
        expect(buildConnectionConfig(unverified, 'postgres', { ...stored, ssl: false }).ssl).toBe(false);

    });

    it('should store nothing for an empty field under a stage placeholder', () => {

        const result = buildConnectionConfig(form({ ...underStage, sslCertFile: './c.pem' }), 'postgres', stored, stageCa);

        expect(result.ssl).toEqual({ certFile: './c.pem' });

    });

});

describe('tui: buildConnectionConfig Use SSL and Verify Certificate', () => {

    const stageCa: ConnectionConfig = { ...stored, ssl: { caFile: './stage-ca.pem' } };
    const stageUnverified: ConnectionConfig = { ...stored, ssl: { rejectUnauthorized: false } };

    it('should store false when Use SSL is unchecked from a stage-supplied ssl', () => {

        expect(buildConnectionConfig(form(), 'postgres', stored, stageCa).ssl).toBe(false);

    });

    it('should store true when Use SSL is checked over a stored false or an absent ssl', () => {

        const existing: ConnectionConfig = { ...stored, ssl: false };

        expect(buildConnectionConfig(form({ useSsl: true }), 'postgres', existing, existing).ssl).toBe(true);
        expect(buildConnectionConfig(form({ useSsl: true }), 'postgres', stored).ssl).toBe(true);

    });

    it('should store rejectUnauthorized false when Verify Certificate is unchecked with Use SSL checked', () => {

        const unverified = form({ useSsl: true, verifyCertificate: false });

        expect(buildConnectionConfig(unverified, 'postgres').ssl).toEqual({ rejectUnauthorized: false });
        expect(buildConnectionConfig(unverified, 'postgres', stored, stageCa).ssl).toEqual({ rejectUnauthorized: false });
        expect(buildConnectionConfig({ ...unverified, sslCaFile: './ca.pem' }, 'postgres', { ...stored, ssl: { caFile: './ca.pem' } }).ssl)
            .toEqual({ caFile: './ca.pem', rejectUnauthorized: false });

    });

    it('should remove a stored rejectUnauthorized false when Verify Certificate is checked', () => {

        const existing: ConnectionConfig = { ...stored, ssl: { caFile: './ca.pem', rejectUnauthorized: false } };

        const result = buildConnectionConfig(form({ useSsl: true, sslCaFile: './ca.pem' }), 'postgres', existing);

        expect(result.ssl).toEqual({ caFile: './ca.pem' });

    });

    it('should store true when Verify Certificate is checked over a stage that supplied the false', () => {

        expect(buildConnectionConfig(form({ useSsl: true }), 'postgres', stored, stageUnverified).ssl).toBe(true);

    });

    it('should store the false with an entered CA path when the stage supplied it and the box stays unchecked', () => {

        const values = form({ useSsl: true, verifyCertificate: false, sslCaFile: './ca.pem' });

        expect(buildConnectionConfig(values, 'postgres', stored, stageUnverified).ssl)
            .toEqual({ caFile: './ca.pem', rejectUnauthorized: false });

    });

    it('should leave ssl absent when the stage supplied the false and nothing changed', () => {

        const result = buildConnectionConfig(form({ useSsl: true, verifyCertificate: false }), 'postgres', stored, stageUnverified);

        expect('ssl' in result).toBe(false);

    });

});

describe('tui: buildSslFields effective state', () => {

    const field = (fields: ReturnType<typeof buildSslFields>, key: string) => fields.find((f) => f.key === key);

    it('should check Use SSL for a stage-supplied ssl and uncheck Verify Certificate for an effective false', () => {

        const fields = buildSslFields(stored, { ...stored, ssl: { caFile: './stage-ca.pem', rejectUnauthorized: false } });

        expect(field(fields, 'useSsl')?.defaultValue).toBe(true);
        expect(field(fields, 'verifyCertificate')?.defaultValue).toBe(false);

    });

    it('should leave a field only the stage supplies empty, with the stage placeholder', () => {

        const existing: ConnectionConfig = { ...stored, ssl: { certFile: './c.pem' } };
        const fields = buildSslFields(existing, { ...stored, ssl: { caFile: './stage-ca.pem', certFile: './c.pem' } });

        expect(field(fields, 'sslCaFile')).toMatchObject({ defaultValue: '', placeholder: '(stage: ./stage-ca.pem)' });
        expect(field(fields, 'sslCertFile')).toMatchObject({ defaultValue: './c.pem', placeholder: '(optional)' });

    });

    it('should show no stage state when called with no connection, as the add form calls it', () => {

        const fields = buildSslFields();

        expect(fields.map((f) => f.key)).toEqual(['useSsl', 'verifyCertificate', 'sslCaFile', 'sslCertFile', 'sslKeyFile', 'tlsServerName']);
        expect(field(fields, 'useSsl')?.defaultValue).toBe(false);
        expect(field(fields, 'verifyCertificate')?.defaultValue).toBe(true);
        expect(fields.some((f) => f.placeholder?.startsWith('(stage:'))).toBe(false);

    });

    it('should leave Use SSL unchecked with no stage placeholder for a stored ssl false over a stage caFile', () => {

        const existing: ConnectionConfig = { ...stored, ssl: false };
        const fields = buildSslFields(existing, existing);

        expect(field(fields, 'useSsl')?.defaultValue).toBe(false);
        expect(fields.some((f) => f.placeholder?.startsWith('(stage:'))).toBe(false);

    });

});

describe('tui: sslPinnedByRename', () => {

    const stageSsl = { caFile: './stage-ca.pem' };
    const overStage: ConnectionConfig = { ...stored, ssl: stageSsl };
    const shownOn = form({ useSsl: true, verifyCertificate: true });

    it('should keep SSL on when the rename leaves the stage that supplied the only ssl', () => {

        expect(sslPinnedByRename(shownOn, 'postgres', undefined, stored, overStage)).toBe(true);
        expect(sslPinnedByRename(shownOn, 'postgres', false, stored, overStage)).toBe(true);

    });

    it('should keep certificate validation when the new stage skips it', () => {

        expect(sslPinnedByRename(shownOn, 'postgres', { rejectUnauthorized: false }, stored, overStage)).toBe(true);

    });

    it('should keep SSL off when the new stage would turn it on', () => {

        expect(sslPinnedByRename(form(), 'postgres', stageSsl, stored)).toBe(false);

    });

    it('should keep an unverified connection unverified, without copying the stage certificate path', () => {

        const unverifiedStage: ConnectionConfig = { ...stored, ssl: { caFile: './stage-ca.pem', rejectUnauthorized: false } };
        const shownUnverified = form({ useSsl: true, verifyCertificate: false });

        expect(sslPinnedByRename(shownUnverified, 'postgres', undefined, stored, unverifiedStage)).toEqual({ rejectUnauthorized: false });

    });

    it('should store nothing extra when the new name gives the state the form shows', () => {

        expect(sslPinnedByRename(shownOn, 'postgres', stageSsl, stored, overStage)).toBeUndefined();
        expect(sslPinnedByRename(shownOn, 'postgres', undefined, { ...stored, ssl: true })).toBeUndefined();
        expect(sslPinnedByRename(form(), 'postgres', undefined, stored)).toBeUndefined();
        expect(sslPinnedByRename(shownOn, 'sqlite', undefined, stored, overStage)).toBeUndefined();

    });

});

describe('tui: validateSslForm effective result', () => {

    const stageSsl = { caFile: './stage-ca.pem' };
    const stageCa: ConnectionConfig = { ...stored, ssl: stageSsl };

    it('should pass a TLS server name when the stage supplies ssl beneath an untouched Use SSL', () => {

        expect(validateSslForm(form({ tlsServerName: 'db.corp' }), 'postgres', stageSsl)).toBeUndefined();
        expect(validateSslForm(form({ useSsl: true, tlsServerName: 'db.corp' }), 'mysql', stageSsl, stored, stageCa)).toBeUndefined();

    });

    it('should fail a TLS server name when Use SSL is unchecked over a stage that supplies ssl', () => {

        expect(validateSslForm(form({ tlsServerName: 'db.corp' }), 'postgres', stageSsl, stored, stageCa)).toContain('TLS server name');

    });

    it('should fail a TLS server name for PostgreSQL and MySQL when the effective rejectUnauthorized is false', () => {

        const unverified = form({ useSsl: true, verifyCertificate: false, tlsServerName: 'db.corp' });
        const stageUnverified = { rejectUnauthorized: false };

        expect(validateSslForm(unverified, 'postgres')).toContain('Verify Certificate');
        expect(validateSslForm(unverified, 'mysql', stageUnverified, stored, { ...stored, ssl: stageUnverified })).toContain('Verify Certificate');
        expect(validateSslForm(unverified, 'mssql')).toBeUndefined();

    });

    it('should fail a certificate path on the add form when Use SSL is unchecked, whatever the stage supplies', () => {

        expect(validateSslForm(form({ sslCertFile: './c.pem' }), 'postgres', stageSsl)).toContain('certificate file');

    });

    it('should fail a TLS server name on a stored ssl false left untouched over a stage', () => {

        const existing: ConnectionConfig = { ...stored, ssl: false };

        expect(validateSslForm(form({ tlsServerName: 'db.corp' }), 'postgres', stageSsl, existing, existing)).toContain('TLS server name');

    });

});

describe('tui: validateSslForm', () => {

    const named = form({ tlsServerName: 'db.corp' });

    it('should fail on the add form for PostgreSQL and MySQL when Use SSL is unchecked', () => {

        expect(validateSslForm(named, 'postgres')).toContain('TLS server name');
        expect(validateSslForm(named, 'mysql')).toContain('TLS server name');

    });

    it('should pass when Use SSL is checked or no name is set', () => {

        expect(validateSslForm(form({ tlsServerName: 'db.corp', useSsl: true }), 'postgres')).toBeUndefined();
        expect(validateSslForm(form(), 'postgres')).toBeUndefined();

    });

    it('should fail on the edit form when Use SSL is unchecked from a stored truthy ssl', () => {

        expect(validateSslForm(named, 'postgres', undefined, { ...stored, ssl: true })).toContain('TLS server name');
        expect(validateSslForm(named, 'mysql', undefined, { ...stored, ssl: { rejectUnauthorized: false } })).toContain('TLS server name');

    });

    it('should fail on the edit form when Use SSL is unchecked and the stored config has no ssl', () => {

        expect(validateSslForm(named, 'postgres', undefined, stored)).toContain('TLS server name');
        expect(validateSslForm(named, 'mysql', undefined, { ...stored, dialect: 'mysql' })).toContain('TLS server name');

    });

    it('should always pass for MSSQL', () => {

        expect(validateSslForm(named, 'mssql')).toBeUndefined();
        expect(validateSslForm(named, 'mssql', undefined, { ...stored, dialect: 'mssql', ssl: true })).toBeUndefined();

    });

    it('should fail a stored ssl false that is unchecked with a TLS server name', () => {

        expect(validateSslForm(named, 'postgres', undefined, { ...stored, ssl: false })).toContain('TLS server name');

    });

    describe('certificate path without Use SSL', () => {

        it('should fail any non-empty path on the add form, on every server dialect', () => {

            for (const dialect of ['postgres', 'mysql', 'mssql'] as const) {

                expect(validateSslForm(form({ sslCaFile: './ca.pem' }), dialect)).toContain('certificate file');
                expect(validateSslForm(form({ sslKeyFile: './k.pem' }), dialect)).toContain('Use SSL');

            }

        });

        it('should pass an untouched stored path that is itself padded with whitespace', () => {

            const existing: ConnectionConfig = { ...stored, ssl: { caFile: ' ./ca.pem ' } };

            expect(validateSslForm(form({ sslCaFile: ' ./ca.pem ' }), 'postgres', undefined, existing)).toBeUndefined();

        });

        it('should fail a changed or newly entered path on the edit form', () => {

            const existing: ConnectionConfig = { ...stored, ssl: { caFile: './ca.pem' } };

            expect(validateSslForm(form({ sslCaFile: './other.pem' }), 'postgres', undefined, existing)).toContain('certificate file');
            expect(validateSslForm(form({ sslCertFile: './c.pem' }), 'mssql', undefined, existing)).toContain('certificate file');

        });

        it('should pass an untouched stored path with Use SSL unchecked', () => {

            const existing: ConnectionConfig = { ...stored, ssl: { caFile: './ca.pem' } };

            expect(validateSslForm(form({ sslCaFile: ' ./ca.pem ' }), 'postgres', undefined, existing)).toBeUndefined();

        });

        it('should pass a whitespace-only path and a checked Use SSL', () => {

            expect(validateSslForm(form({ sslCaFile: '  ' }), 'postgres')).toBeUndefined();
            expect(validateSslForm(form({ useSsl: true, sslCaFile: './ca.pem' }), 'postgres')).toBeUndefined();

        });

        it('should not apply to SQLite', () => {

            expect(validateSslForm(form({ sslCaFile: './ca.pem' }), 'sqlite')).toBeUndefined();

        });

    });

});
