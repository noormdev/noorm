/**
 * Config schema validation tests.
 */
import { describe, it, expect } from 'bun:test';

import {
    validateConfig,
    validateConfigInput,
    parseConfig,
    ConfigValidationError,
} from '../../../src/core/config/index.js';
import type { Config } from '../../../src/core/config/index.js';
import { guarded } from '../../../src/core/policy/index.js';

/**
 * Create a valid test config.
 */
function createValidConfig(overrides: Partial<Config> = {}): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        access: { user: 'admin', mcp: 'admin' },
        connection: {
            dialect: 'sqlite',
            database: ':memory:',
        },
        ...overrides,
    };

}

describe('config: schema validation', () => {

    describe('validateConfig', () => {

        it('should accept valid config', () => {

            const config = createValidConfig();
            expect(() => validateConfig(config)).not.toThrow();

        });

        it('should accept all valid dialects', () => {

            const dialects = ['postgres', 'mysql', 'sqlite', 'mssql'] as const;

            for (const dialect of dialects) {

                const config = createValidConfig({
                    connection: {
                        dialect,
                        database: 'test',
                        host: dialect === 'sqlite' ? undefined : 'localhost',
                    },
                });

                expect(() => validateConfig(config)).not.toThrow();

            }

        });

        it('should require name', () => {

            const config = createValidConfig({ name: '' });

            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('Config name is required');

        });

        it('should reject invalid name characters', () => {

            const config = createValidConfig({ name: 'my config!' });

            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('letters, numbers, hyphens');

        });

        it('should accept valid name patterns', () => {

            const validNames = ['dev', 'DEV', 'dev-local', 'dev_local', 'dev123', 'My-Config_123'];

            for (const name of validNames) {

                const config = createValidConfig({ name });
                expect(() => validateConfig(config)).not.toThrow();

            }

        });

        it('should require connection', () => {

            const config = createValidConfig();
            // @ts-expect-error testing invalid input
            delete config.connection;

            expect(() => validateConfig(config)).toThrow(ConfigValidationError);

        });

        it('should require dialect', () => {

            const config = createValidConfig();
            // @ts-expect-error testing invalid input
            delete config.connection.dialect;

            expect(() => validateConfig(config)).toThrow(ConfigValidationError);

        });

        it('should reject invalid dialect', () => {

            const config = createValidConfig();
            // @ts-expect-error testing invalid input
            config.connection.dialect = 'oracle';

            expect(() => validateConfig(config)).toThrow(ConfigValidationError);

        });

        it('should require database', () => {

            const config = createValidConfig();
            // @ts-expect-error testing invalid input
            delete config.connection.database;

            expect(() => validateConfig(config)).toThrow(ConfigValidationError);

        });

        it('should require host for non-SQLite databases', () => {

            const config = createValidConfig({
                connection: {
                    dialect: 'postgres',
                    database: 'test',
                    // missing host
                },
            });

            expect(() => validateConfig(config)).toThrow('Host is required for non-SQLite');

        });

        it('should not require host for SQLite', () => {

            const config = createValidConfig({
                connection: {
                    dialect: 'sqlite',
                    database: ':memory:',
                },
            });

            expect(() => validateConfig(config)).not.toThrow();

        });

        it('should validate port range', () => {

            const lowConfig = createValidConfig({
                connection: { dialect: 'sqlite', database: ':memory:', port: 0 },
            });

            expect(() => validateConfig(lowConfig)).toThrow('Port must be at least 1');

            const highConfig = createValidConfig({
                connection: { dialect: 'sqlite', database: ':memory:', port: 99999 },
            });

            expect(() => validateConfig(highConfig)).toThrow('Port must be at most 65535');

        });

        it('should accept valid port', () => {

            const config = createValidConfig({
                connection: { dialect: 'sqlite', database: ':memory:', port: 5432 },
            });

            expect(() => validateConfig(config)).not.toThrow();

        });

        it('should validate type enum', () => {

            const config = createValidConfig();
            // @ts-expect-error testing invalid input
            config.type = 'invalid';

            expect(() => validateConfig(config)).toThrow(ConfigValidationError);

        });

        it('should include field name in error', () => {

            const config = createValidConfig({ name: '' });

            try {

                validateConfig(config);

            }
            catch (err) {

                expect(err).toBeInstanceOf(ConfigValidationError);
                expect((err as ConfigValidationError).field).toBe('name');

            }

        });

        it('should include issues array in error', () => {

            const config = createValidConfig({ name: '' });

            try {

                validateConfig(config);

            }
            catch (err) {

                expect(err).toBeInstanceOf(ConfigValidationError);
                expect((err as ConfigValidationError).issues).toBeInstanceOf(Array);
                expect((err as ConfigValidationError).issues.length).toBeGreaterThan(0);

            }

        });

    });

    describe('validateConfigInput', () => {

        it('should accept empty input', () => {

            expect(() => validateConfigInput({})).not.toThrow();

        });

        it('should validate name when present', () => {

            expect(() => validateConfigInput({ name: 'valid-name' })).not.toThrow();
            expect(() => validateConfigInput({ name: 'invalid name!' })).toThrow();

        });

        it('should accept partial connection config', () => {

            // Partial schema allows partial connection without database
            expect(() =>
                validateConfigInput({
                    connection: { host: 'localhost' },
                }),
            ).not.toThrow();

        });

        it('should validate port when present', () => {

            expect(() => validateConfigInput({ connection: { port: 5432 } })).not.toThrow();
            expect(() => validateConfigInput({ connection: { port: 99999 } })).toThrow();

        });

        it('should validate type when present', () => {

            expect(() => validateConfigInput({ type: 'local' })).not.toThrow();
            expect(() => validateConfigInput({ type: 'remote' })).not.toThrow();
            expect(() => validateConfigInput({ type: 'invalid' })).toThrow();

        });

    });

    describe('parseConfig', () => {

        it('should apply defaults for missing optional fields', () => {

            const minimal = {
                name: 'minimal',
                connection: {
                    dialect: 'sqlite' as const,
                    database: ':memory:',
                },
            };

            const result = parseConfig(minimal);

            expect(result.type).toBe('local');
            expect(result.isTest).toBe(false);
            expect(result.access).toEqual({ user: 'admin', mcp: 'viewer' });

        });

        it('should preserve provided values', () => {

            const config = createValidConfig({
                type: 'remote',
                isTest: true,
                access: { user: 'operator', mcp: 'viewer' },
            });

            const result = parseConfig(config);

            expect(result.type).toBe('remote');
            expect(result.isTest).toBe(true);
            expect(result.access).toEqual({ user: 'operator', mcp: 'viewer' });

        });

        it('should throw on invalid config', () => {

            const invalid = { name: '' };

            expect(() => parseConfig(invalid)).toThrow(ConfigValidationError);

        });

        describe('access roles', () => {

            /** Strips the default `access` so the legacy `protected` fallback is reachable. */
            function withoutAccess(config: Config): Omit<Config, 'access'> {

                const { access: _access, ...rest } = config;

                return rest;

            }

            it('should default access to admin on the user channel and viewer on the agent channel', () => {

                const result = parseConfig(withoutAccess(createValidConfig()));

                expect(result.access).toEqual({ user: 'admin', mcp: 'viewer' });
                expect(guarded(result)).toBe(false);

            });

            it('should map legacy protected: true to guarded access', () => {

                const config = { ...withoutAccess(createValidConfig()), protected: true };

                const result = parseConfig(config);

                expect(result.access).toEqual({ user: 'operator', mcp: 'viewer' });
                expect(guarded(result)).toBe(true);

            });

            it('should treat legacy protected: false as the default, not an agent-admin grant', () => {

                const config = { ...withoutAccess(createValidConfig()), protected: false };

                const result = parseConfig(config);

                expect(result.access).toEqual({ user: 'admin', mcp: 'viewer' });
                expect(guarded(result)).toBe(false);

            });

            it('should prefer an explicit access over the legacy protected flag', () => {

                const config = {
                    ...createValidConfig(),
                    protected: true,
                    access: { user: 'viewer' as const, mcp: false as const },
                };

                const result = parseConfig(config);

                expect(result.access).toEqual({ user: 'viewer', mcp: false });

            });

            it('should never let the raw input protected value override an explicit access', () => {

                // access says open (admin/admin) while the legacy protected
                // flag says guarded; the resolved access must follow the
                // explicit access, never the raw input's protected flag.
                const config = {
                    ...createValidConfig(),
                    protected: true,
                    access: { user: 'admin' as const, mcp: 'admin' as const },
                };

                const result = parseConfig(config);

                expect(guarded(result)).toBe(false);

            });

        });

    });

    describe('database name validation (ConnectionSchema refine)', () => {

        const dangerousChars: Array<[label: string, char: string]> = [
            ['double quote', '"'],
            ['single quote', '\''],
            ['backtick', '`'],
            ['opening bracket', '['],
            ['closing bracket', ']'],
            ['semicolon', ';'],
            ['NUL control char', '\x00'],
            ['unit separator control char', '\x1f'],
            ['DEL control char', '\x7f'],
        ];

        const serverDialects = ['postgres', 'mysql', 'mssql'] as const;

        for (const dialect of serverDialects) {

            describe(dialect, () => {

                for (const [label, char] of dangerousChars) {

                    it(`should reject a database name containing a ${label}`, () => {

                        const config = createValidConfig({
                            connection: { dialect, database: `db${char}name`, host: 'localhost' },
                        });

                        expect(() => validateConfig(config)).toThrow(ConfigValidationError);
                        expect(() => validateConfig(config)).toThrow(
                            'Database name must not contain quotes, backticks, brackets, semicolons, or control characters',
                        );

                    });

                }

                it('should accept normal database names (dots, dashes, spaces, underscores, unicode)', () => {

                    const validNames = ['myapp', 'my-app', 'my.app', 'my app', 'my_app', 'café_db'];

                    for (const database of validNames) {

                        const config = createValidConfig({
                            connection: { dialect, database, host: 'localhost' },
                        });

                        expect(() => validateConfig(config)).not.toThrow();

                    }

                });

                it('should report the field as connection.database', () => {

                    const config = createValidConfig({
                        connection: { dialect, database: 'bad"name', host: 'localhost' },
                    });

                    try {

                        validateConfig(config);

                    }
                    catch (err) {

                        expect(err).toBeInstanceOf(ConfigValidationError);
                        expect((err as ConfigValidationError).field).toBe('connection.database');

                    }

                });

            });

        }

        describe('sqlite (exempt)', () => {

            it('should accept :memory:', () => {

                const config = createValidConfig({
                    connection: { dialect: 'sqlite', database: ':memory:' },
                });

                expect(() => validateConfig(config)).not.toThrow();

            });

            it('should accept a file path containing brackets and quotes', () => {

                const config = createValidConfig({
                    connection: { dialect: 'sqlite', database: './data/app[1]\'s.db' },
                });

                expect(() => validateConfig(config)).not.toThrow();

            });

        });

    });

});
