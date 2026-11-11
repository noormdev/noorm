// Fixtures are throwaway text, never real key material.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { attempt, attemptSync } from '@logosdx/utils';

import { SslFileError, isSslFileErrorMessage, resolveSslFiles } from '../../../src/core/connection/ssl-files.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';

const probeDir = mkdtempSync(join(tmpdir(), 'noorm-ssl-probe-'));
const [, mkfifoErr] = attemptSync(() => execFileSync('mkfifo', [join(probeDir, 'probe.fifo')]));
const hasMkfifo = mkfifoErr === null;

rmSync(probeDir, { recursive: true, force: true });

const pem = (label: string, body = 'throwaway'): string => `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;

describe('connection: resolveSslFiles', () => {

    let dir: string;

    const base: ConnectionConfig = { dialect: 'postgres', host: 'db.example.com', database: 'app' };

    beforeEach(() => {

        dir = mkdtempSync(join(tmpdir(), 'noorm-ssl-files-'));

    });

    afterEach(() => {

        rmSync(dir, { recursive: true, force: true });

    });

    it('should read each file field into its inline field and drop the file field', async () => {

        const caFile = join(dir, 'ca.pem');
        const certFile = join(dir, 'cert.pem');
        const keyFile = join(dir, 'key.pem');

        writeFileSync(caFile, pem('CERTIFICATE', 'throwaway-ca'));
        writeFileSync(certFile, pem('CERTIFICATE', 'throwaway-cert'));
        writeFileSync(keyFile, pem('PRIVATE KEY', 'throwaway-key'));

        const resolved = await resolveSslFiles({ ...base, ssl: { caFile, certFile, keyFile, rejectUnauthorized: true } });

        expect(resolved.ssl).toEqual({
            ca: pem('CERTIFICATE', 'throwaway-ca'),
            cert: pem('CERTIFICATE', 'throwaway-cert'),
            key: pem('PRIVATE KEY', 'throwaway-key'),
            rejectUnauthorized: true,
        });

    });

    it('should return a new connection and leave the one it received holding paths and no PEM', async () => {

        const caFile = join(dir, 'ca.pem');

        writeFileSync(caFile, pem('CERTIFICATE'));

        const input: ConnectionConfig = { ...base, ssl: { caFile } };
        const resolved = await resolveSslFiles(input);

        expect(resolved).not.toBe(input);
        expect(input.ssl).toEqual({ caFile });

    });

    it('should leave inline fields and non-object ssl as they are', async () => {

        expect((await resolveSslFiles({ ...base, ssl: true })).ssl).toBe(true);
        expect((await resolveSslFiles(base)).ssl).toBeUndefined();
        expect((await resolveSslFiles({ ...base, ssl: { ca: 'inline-ca' } })).ssl).toEqual({ ca: 'inline-ca' });

    });

    it('should return a sqlite config unchanged, without reading any file', async () => {

        const input: ConnectionConfig = { dialect: 'sqlite', database: ':memory:', ssl: { caFile: join(dir, 'missing.pem') } };
        const resolved = await resolveSslFiles(input);

        expect(resolved).toBe(input);

    });

    it('should refuse a file over 1 MiB with EFBIG before reading it', async () => {

        const caFile = join(dir, 'big.pem');

        writeFileSync(caFile, pem('CERTIFICATE'));
        truncateSync(caFile, 1024 * 1024 + 1);

        const [, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile } }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('code', 'EFBIG');
        expect(err?.message).toContain('is larger than 1 MiB');

    });

    it('should pass the size check for a file of exactly 1 MiB', async () => {

        const caFile = join(dir, 'limit.pem');
        const body = pem('CERTIFICATE');

        writeFileSync(caFile, body + ' '.repeat(1024 * 1024 - body.length));

        const resolved = await resolveSslFiles({ ...base, ssl: { caFile } });

        expect(resolved.ssl).toHaveProperty('ca');

    });

    it('should resolve a relative path from the working directory', async () => {

        writeFileSync(join(dir, 'ca.pem'), pem('CERTIFICATE', 'relative-ca'));

        const previous = process.cwd();

        process.chdir(dir);

        const [resolved, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile: 'ca.pem' } }));

        process.chdir(previous);

        expect(err).toBeNull();
        expect(resolved?.ssl).toEqual({ ca: pem('CERTIFICATE', 'relative-ca') });

    });

    it('should throw SslFileError with the field, path and system code for a missing file', async () => {

        const caFile = join(dir, 'missing.pem');
        const [, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile } }));

        expect(err).toBeInstanceOf(SslFileError);

        if (!(err instanceof SslFileError)) return;

        expect(err.field).toBe('ssl.caFile');
        expect(err.path).toBe(caFile);
        expect(err.code).toBe('ENOENT');
        expect(err.message).toContain('ssl.caFile');
        expect(err.message).toContain(caFile);

    });

    it('should read a rotated file again on the next call', async () => {

        const caFile = join(dir, 'ca.pem');

        writeFileSync(caFile, pem('CERTIFICATE', 'first-ca'));
        expect((await resolveSslFiles({ ...base, ssl: { caFile } })).ssl).toEqual({ ca: pem('CERTIFICATE', 'first-ca') });

        writeFileSync(caFile, pem('CERTIFICATE', 'rotated-ca'));
        expect((await resolveSslFiles({ ...base, ssl: { caFile } })).ssl).toEqual({ ca: pem('CERTIFICATE', 'rotated-ca') });

    });

    it('should put a malformed keyFile only in the resolved ssl.key', async () => {

        const caFile = join(dir, 'ca.pem');
        const certFile = join(dir, 'cert.pem');
        const keyFile = join(dir, 'key.pem');

        const key = pem('PRIVATE KEY', 'NOT-A-KEY-secret-marker');

        writeFileSync(caFile, pem('CERTIFICATE', 'throwaway-ca'));
        writeFileSync(certFile, pem('CERTIFICATE', 'throwaway-cert'));
        writeFileSync(keyFile, key);

        const resolved = await resolveSslFiles({ ...base, ssl: { caFile, certFile, keyFile } });

        expect(resolved.ssl).toEqual({
            ca: pem('CERTIFICATE', 'throwaway-ca'),
            cert: pem('CERTIFICATE', 'throwaway-cert'),
            key,
        });

    });

    it('should refuse a directory with EINVAL and say it is not a regular file', async () => {

        const [, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile: dir } }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('code', 'EINVAL');
        expect(err).toHaveProperty('field', 'ssl.caFile');
        expect(err?.message).toBe(`ssl.caFile '${dir}' is not a regular file`);

    });

    it.skipIf(!hasMkfifo)('should refuse a FIFO with EINVAL without blocking on it', async () => {

        const fifo = join(dir, 'ca.fifo');

        execFileSync('mkfifo', [fifo]);

        const [, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile: fifo } }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('code', 'EINVAL');

    }, 2000);

    it.skipIf(process.getuid?.() === 0)('should refuse an empty file with EMPTY', async () => {

        const caFile = join(dir, 'empty.pem');

        writeFileSync(caFile, '');
        // A raw read of an unreadable file gives EACCES, so EMPTY proves the size check ran first.
        chmodSync(caFile, 0);

        const [, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile } }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('code', 'EMPTY');
        expect(err?.message).toBe(`ssl.caFile '${caFile}' is empty`);

    });

    it('should refuse a whitespace-only file with EMPTY', async () => {

        const caFile = join(dir, 'blank.pem');

        writeFileSync(caFile, '  \n\t\n');

        const [, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile } }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('code', 'EMPTY');

    });

    it('should refuse a file with no PEM block with ENOTPEM and keep its content out of the message', async () => {

        const caFile = join(dir, 'random.pem');

        writeFileSync(caFile, 'random-text-secret-marker');

        const [, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile } }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('code', 'ENOTPEM');
        expect(err).toHaveProperty('field', 'ssl.caFile');
        expect(err?.message).toBe(`ssl.caFile '${caFile}' is not a PEM file`);
        expect(err?.message).not.toContain('random-text-secret-marker');

    });

    it('should accept a file that holds a PEM block', async () => {

        const caFile = join(dir, 'ca.pem');

        writeFileSync(caFile, pem('CERTIFICATE'));

        const [resolved, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile } }));

        expect(err).toBeNull();
        expect(resolved?.ssl).toEqual({ ca: pem('CERTIFICATE') });

    });

    it.each(['\n', '\r\n'])('should accept a PEM file that starts with a byte-order mark and uses %j line endings', async (eol) => {

        const caFile = join(dir, 'bom.pem');
        const content = `\uFEFF${pem('CERTIFICATE').replaceAll('\n', eol)}`;

        writeFileSync(caFile, content);

        const [resolved, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile } }));

        expect(err).toBeNull();
        expect(resolved?.ssl).toEqual({ ca: content });

    });

    it('should refuse a DER-shaped keyFile with ENOTPEM and keep it out of the message', async () => {

        const keyFile = join(dir, 'key.der');

        writeFileSync(keyFile, Buffer.from([0x30, 0x82, 0x01, 0x0a, 0x02, 0x82, 0x01, 0x01, 0x00, 0xff, 0xfe]));

        const [, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { keyFile } }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('code', 'ENOTPEM');
        expect(err?.message).toBe(`ssl.keyFile '${keyFile}' is not a PEM file`);

    });

    it('should accept leading whitespace and comment lines before the PEM block', async () => {

        const caFile = join(dir, 'bundle.pem');
        const content = `  \n# Issuer: throwaway\nSubject: throwaway\n${pem('CERTIFICATE')}`;

        writeFileSync(caFile, content);

        const [resolved, err] = await attempt(() => resolveSslFiles({ ...base, ssl: { caFile } }));

        expect(err).toBeNull();
        expect(resolved?.ssl).toEqual({ ca: content });

    });

});

describe('connection: isSslFileErrorMessage', () => {

    // A path that holds the words the missing-database classifiers look for.
    const path = '/srv/does not exist/unknown database/ca.pem';

    it.each(['ENOENT', 'EINVAL', 'EMPTY', 'EFBIG', 'ENOTPEM'])('should be true for the message of an SslFileError with code %s', (code) => {

        const { message } = new SslFileError('ssl.caFile', path, code);

        expect(isSslFileErrorMessage(message)).toBe(true);
        expect(isSslFileErrorMessage(`Connection failed: ${message}`)).toBe(true);

    });

    it.each([
        ['PostgreSQL', 'database "app" does not exist'],
        ['MySQL', "Unknown database 'app'"],
        ['MSSQL', "Database 'app' does not exist. Make sure that the name is entered correctly."],
    ])('should be false for the %s missing-database message', (_dialect, message) => {

        expect(isSslFileErrorMessage(message)).toBe(false);
        expect(isSslFileErrorMessage(`Connection failed: ${message}`)).toBe(false);

    });

});
