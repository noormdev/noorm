import { describe, expect, it } from 'bun:test';
import { materializeStage, restrictAccess, stageFields } from '../../../src/core/config/stage.js';
import { getEnvConfig } from '../../../src/core/config/index.js';

describe('stage materialization', () => {

    it('omits stage credentials and clamps protected access', () => {

        const config = materializeStage('review', 'staging', { dialect: 'postgres', password: 'secret', protected: true, access: { user: 'admin', agent: 'admin' } });
        expect(config.connection.database).toBe('staging');
        expect(config.connection.password).toBeUndefined();
        expect(config.access).toEqual({ user: 'operator', agent: 'viewer' });

    });
    it('accepts only explicitly supplied stored credentials', () => {

        const config = materializeStage('review', 'staging', { dialect: 'sqlite', password: 'stage' }, { connection: { password: 'environment' } }, 'explicit');
        expect(config.connection.password).toBe('explicit');
        expect(stageFields({ password: 'secret' }).connection).toEqual({});
        expect(restrictAccess({ user: 'viewer', agent: false }, { user: 'admin', agent: 'admin' })).toEqual({ user: 'viewer', agent: false });

    });

});

describe('connection environment mapping', () => {

    it('preserves types and rejects scalar/nested SSL collisions', () => {

        const keys = ['NOORM_CONNECTION_CONNECT_TIMEOUT_MS', 'NOORM_CONNECTION_SSL_REJECT_UNAUTHORIZED', 'NOORM_CONNECTION_PASSWORD', 'NOORM_CONNECTION_SSL'];
        const saved = keys.map((key) => process.env[key]);
        try {

            process.env[keys[0]!] = '30000';
            process.env[keys[1]!] = 'false';
            process.env[keys[2]!] = '123';
            delete process.env[keys[3]!];
            expect(getEnvConfig().connection).toMatchObject({ connectTimeoutMs: 30000, ssl: { rejectUnauthorized: false }, password: '123' });
            process.env[keys[3]!] = 'true';
            expect(() => getEnvConfig()).toThrow('NOORM_CONNECTION_SSL');

        }
        finally {

            keys.forEach((key, index) => {

                if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];

            });

        }

    });

});
