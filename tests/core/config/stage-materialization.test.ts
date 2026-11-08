import { afterEach, describe, expect, it } from 'bun:test';
import { materializeStage, stageFields } from '../../../src/core/config/stage.js';
import { getEnvConfig } from '../../../src/core/config/index.js';
import { clampToCeiling } from '../../../src/core/policy/index.js';
import type { ConfigInput } from '../../../src/core/config/types.js';

describe('stage materialization', () => {

    it('omits stage credentials and clamps protected access', () => {

        const config = materializeStage('review', 'staging', {
            dialect: 'postgres',
            password: 'secret',
            protected: true,
            access: { user: 'admin', agent: 'admin' },
        });

        expect(config.connection.database).toBe('staging');
        expect(config.connection.password).toBeUndefined();
        expect(config.access).toEqual({ user: 'operator', agent: 'viewer' });

    });

    it('accepts only explicitly supplied stored credentials', () => {

        const config = materializeStage(
            'review',
            'staging',
            { dialect: 'sqlite', password: 'stage' },
            { connection: { password: 'environment' } },
            'explicit',
        );

        expect(config.connection.password).toBe('explicit');
        expect(stageFields({ password: 'secret' }).connection).toEqual({});
        expect(clampToCeiling(
            { user: 'viewer', agent: false },
            { user: 'admin', agent: 'admin' },
        )).toEqual({ user: 'viewer', agent: false });

    });

    it('keeps runtime stage passwords separate from password-free persistence', () => {

        const defaults = { dialect: 'postgres' as const, password: 'stage-password' };

        expect(stageFields(defaults, true).connection?.password).toBe('stage-password');
        expect(materializeStage('ci', 'ci', defaults).connection.password).toBeUndefined();
        expect(materializeStage('ci', 'ci', defaults, {}, defaults.password).connection.password)
            .toBe('stage-password');

    });

    it('does not let a complete environment input replace stage identity or access', () => {

        const overrides: ConfigInput = {
            name: 'redirected',
            type: 'local',
            isTest: false,
            access: { user: 'admin', agent: 'admin' },
            connection: { host: 'env.example.com', password: 'environment' },
        };
        const config = materializeStage('selected', 'ci', {
            dialect: 'postgres',
            type: 'remote',
            isTest: true,
            access: { user: 'viewer', agent: false },
        }, overrides);

        expect(config.name).toBe('selected');
        expect(config.type).toBe('remote');
        expect(config.isTest).toBe(true);
        expect(config.access).toEqual({ user: 'viewer', agent: false });
        expect(config.connection.host).toBe('env.example.com');
        expect(config.connection.password).toBeUndefined();

    });

});

describe('connection environment mapping', () => {

    const saved: Record<string, string | undefined> = {};

    afterEach(() => {

        for (const [key, value] of Object.entries(saved)) {

            if (value === undefined) {

                delete process.env[key];

            }
            else {

                process.env[key] = value;

            }

        }

    });

    it('preserves connection value types', () => {

        const values = {
            NOORM_CONNECTION_connectTimeoutMs: '30000',
            NOORM_CONNECTION_SSL_rejectUnauthorized: 'false',
            NOORM_CONNECTION_PASSWORD: '123',
        };

        for (const [key, value] of Object.entries(values)) {

            saved[key] = process.env[key];
            process.env[key] = value;

        }

        expect(getEnvConfig().connection).toMatchObject({
            connectTimeoutMs: 30000,
            ssl: { rejectUnauthorized: false },
            password: '123',
        });

    });

});
