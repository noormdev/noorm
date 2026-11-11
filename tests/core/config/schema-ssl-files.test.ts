import { describe, it, expect } from 'bun:test';
import { attemptSync } from '@logosdx/utils';

import {
    parseConfig,
    validateConfigInput,
    ConfigValidationError,
} from '../../../src/core/config/index.js';

function configWithSsl(ssl: unknown) {

    return {
        name: 'test',
        type: 'remote',
        isTest: false,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect: 'postgres', host: 'db', database: 'app', ssl },
    };

}

describe('config: ssl file fields', () => {

    it('should accept caFile, certFile and keyFile on a full config', () => {

        const config = parseConfig(configWithSsl({
            caFile: './certs/ca.pem',
            certFile: './certs/client.pem',
            keyFile: './certs/client.key',
        }));

        expect(config.connection.ssl).toEqual({
            caFile: './certs/ca.pem',
            certFile: './certs/client.pem',
            keyFile: './certs/client.key',
        });

    });

    it('should accept the file fields on a partial config', () => {

        const [, err] = attemptSync(() => validateConfigInput({
            connection: { ssl: { caFile: './ca.pem', certFile: './c.pem', keyFile: './k.pem' } },
        }));

        expect(err).toBeNull();

    });

    it('should accept a file field next to the inline form of a different field', () => {

        const [, err] = attemptSync(() => parseConfig(configWithSsl({ ca: 'PEM', certFile: './c.pem' })));

        expect(err).toBeNull();

    });

    describe.each(['caFile', 'certFile', 'keyFile'])('empty %s', (file) => {

        it('should be rejected on a full config, naming the field', () => {

            const [, err] = attemptSync(() => parseConfig(configWithSsl({ [file]: '' })));

            expect(err).toBeInstanceOf(ConfigValidationError);
            expect(err?.message).toContain(`ssl.${file}`);

        });

        it('should be rejected on a partial config, naming the field', () => {

            const [, err] = attemptSync(() => validateConfigInput({ connection: { ssl: { [file]: '' } } }));

            expect(err).toBeInstanceOf(ConfigValidationError);
            expect(err?.message).toContain(`ssl.${file}`);

        });

        it('should reject a whitespace-only path like an empty one', () => {

            const [, err] = attemptSync(() => parseConfig(configWithSsl({ [file]: '  \t ' })));

            expect(err).toBeInstanceOf(ConfigValidationError);
            expect(err?.message).toContain(`ssl.${file} must not be empty`);

        });

    });

    describe.each([
        ['ca', 'caFile'],
        ['cert', 'certFile'],
        ['key', 'keyFile'],
    ])('%s with %s', (inline, file) => {

        it('should be rejected on a full config, naming the field', () => {

            const [, err] = attemptSync(() => parseConfig(configWithSsl({ [inline]: 'PEM', [file]: './x.pem' })));

            expect(err).toBeInstanceOf(ConfigValidationError);
            expect(err?.message).toContain(`ssl.${inline}`);

        });

        it('should be rejected on a partial config, naming the field', () => {

            const [, err] = attemptSync(() => validateConfigInput({
                connection: { ssl: { [inline]: 'PEM', [file]: './x.pem' } },
            }));

            expect(err).toBeInstanceOf(ConfigValidationError);
            expect(err?.message).toContain(`ssl.${inline}`);

        });

    });

});
