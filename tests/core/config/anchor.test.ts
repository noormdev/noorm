import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { anchorSslFiles } from '../../../src/core/config/anchor.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';

describe('config: anchorSslFiles', () => {

    const root = join('/', 'projects', 'app');
    const base: ConnectionConfig = { dialect: 'postgres', host: 'db.example.com', database: 'app' };

    it('should join each relative file path to the project root', () => {

        const anchored = anchorSslFiles(
            { ...base, ssl: { caFile: 'certs/ca.pem', certFile: './cert.pem', keyFile: '../key.pem', rejectUnauthorized: false } },
            root,
        );

        expect(anchored.ssl).toEqual({
            caFile: join(root, 'certs/ca.pem'),
            certFile: join(root, 'cert.pem'),
            keyFile: join('/', 'projects', 'key.pem'),
            rejectUnauthorized: false,
        });

    });

    it('should leave an absolute path as written', () => {

        const caFile = join('/', 'etc', 'ssl', '..', 'ssl', 'ca.pem');

        expect(anchorSslFiles({ ...base, ssl: { caFile } }, root).ssl).toEqual({ caFile });

    });

    it('should leave a ~/ path as written', () => {

        expect(anchorSslFiles({ ...base, ssl: { caFile: '~/ca.pem' } }, root).ssl).toEqual({ caFile: '~/ca.pem' });

    });

    it('should leave an empty path as written', () => {

        expect(anchorSslFiles({ ...base, ssl: { caFile: '' } }, root).ssl).toEqual({ caFile: '' });

    });

    it('should leave a non-file ssl untouched', () => {

        for (const ssl of [true, false, undefined, { ca: 'INLINE-PEM' }]) {

            expect(anchorSslFiles({ ...base, ssl }, root)).toEqual({ ...base, ssl });

        }

    });

    it('should not mutate its input', () => {

        const input: ConnectionConfig = { ...base, ssl: { caFile: 'ca.pem' } };

        const anchored = anchorSslFiles(input, root);

        expect(input.ssl).toEqual({ caFile: 'ca.pem' });
        expect(anchored).not.toBe(input);

    });

});
