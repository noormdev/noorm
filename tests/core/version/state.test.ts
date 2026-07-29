/**
 * Tests for state version manager.
 */
import { describe, it, expect, beforeEach } from 'bun:test';

import { observer } from '../../../src/core/observer.js';
import { CURRENT_VERSIONS, VersionMismatchError } from '../../../src/core/version/types.js';
import {
    getStateVersion,
    checkStateVersion,
    needsStateMigration,
    migrateState,
    createEmptyVersionedState,
    ensureStateVersion,
} from '../../../src/core/version/state/index.js';

describe('version: state', () => {

    beforeEach(() => {

        observer.clear();

    });

    describe('getStateVersion', () => {

        it('should return schemaVersion from state', () => {

            const state = { schemaVersion: 5 };

            expect(getStateVersion(state)).toBe(5);

        });

        it('should return 0 for missing schemaVersion', () => {

            const state = {};

            expect(getStateVersion(state)).toBe(0);

        });

        it('should return 0 for non-number schemaVersion', () => {

            const state = { schemaVersion: '1' };

            expect(getStateVersion(state)).toBe(0);

        });

        it('should return 0 for null schemaVersion', () => {

            const state = { schemaVersion: null };

            expect(getStateVersion(state)).toBe(0);

        });

    });

    describe('checkStateVersion', () => {

        it('should return current and expected versions', () => {

            const state = { schemaVersion: 1 };
            const status = checkStateVersion(state);

            expect(status.current).toBe(1);
            expect(status.expected).toBe(CURRENT_VERSIONS.state);

        });

        it('should detect migration needed when current < expected', () => {

            const state = { schemaVersion: 0 };
            const status = checkStateVersion(state);

            expect(status.needsMigration).toBe(true);
            expect(status.isNewer).toBe(false);

        });

        it('should detect newer version when current > expected', () => {

            const state = { schemaVersion: 999 };
            const status = checkStateVersion(state);

            expect(status.isNewer).toBe(true);
            expect(status.needsMigration).toBe(false);

        });

        it('should detect no migration needed when current == expected', () => {

            const state = { schemaVersion: CURRENT_VERSIONS.state };
            const status = checkStateVersion(state);

            expect(status.needsMigration).toBe(false);
            expect(status.isNewer).toBe(false);

        });

    });

    describe('needsStateMigration', () => {

        it('should return true when migration needed', () => {

            const state = { schemaVersion: 0 };

            expect(needsStateMigration(state)).toBe(true);

        });

        it('should return false when no migration needed', () => {

            const state = { schemaVersion: CURRENT_VERSIONS.state };

            expect(needsStateMigration(state)).toBe(false);

        });

        it('should return false when version is newer', () => {

            const state = { schemaVersion: 999 };

            expect(needsStateMigration(state)).toBe(false);

        });

    });

    describe('migrateState', () => {

        it('should migrate unversioned state to current version', () => {

            const state = {};
            const migrated = migrateState(state);

            expect(migrated['schemaVersion']).toBe(CURRENT_VERSIONS.state);

        });

        it('should add missing fields with defaults', () => {

            const state = {};
            const migrated = migrateState(state);

            expect(migrated['identity']).toBeNull();
            expect(migrated['knownUsers']).toEqual({});
            expect(migrated['activeConfig']).toBeNull();
            expect(migrated['configs']).toEqual({});
            expect(migrated['secrets']).toEqual({});
            expect(migrated['globalSecrets']).toEqual({});

        });

        it('should preserve existing values', () => {

            const state = {
                identity: { name: 'test' },
                activeConfig: 'dev',
                configs: { dev: {} },
            };
            const migrated = migrateState(state);

            expect(migrated['identity']).toEqual({ name: 'test' });
            expect(migrated['activeConfig']).toBe('dev');
            // v2 backfills access roles onto every config (see the "v2:
            // per-config access roles" tests below for the mapping itself).
            expect(migrated['configs']).toEqual({ dev: { access: { user: 'admin', mcp: 'admin' } } });

        });

        it('should preserve unknown top-level fields through the v1 baseline', () => {

            // v1 rebuilt the state object from a fixed field list, so any
            // top-level field a newer build had added was destroyed the
            // first time an older build opened the file -- and the result
            // was persisted immediately.
            const migrated = migrateState({ auditTrail: ['future-field'] });

            expect(migrated['auditTrail']).toEqual(['future-field']);

        });

        it('should return same state if already current version', () => {

            const state = { schemaVersion: CURRENT_VERSIONS.state };
            const migrated = migrateState(state);

            expect(migrated).toBe(state);

        });

        it('should throw VersionMismatchError for newer version', () => {

            const state = { schemaVersion: 999 };

            expect(() => migrateState(state)).toThrow(VersionMismatchError);

        });

        it('should emit version:state:migrating event', () => {

            const events: unknown[] = [];
            observer.on('version:state:migrating', (data) => events.push(data));

            const state = {};
            migrateState(state);

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                from: 0,
                to: CURRENT_VERSIONS.state,
            });

        });

        it('should emit version:state:migrated event', () => {

            const events: unknown[] = [];
            observer.on('version:state:migrated', (data) => events.push(data));

            const state = {};
            migrateState(state);

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                from: 0,
                to: CURRENT_VERSIONS.state,
            });

        });

        it('should emit version:mismatch event for newer version', () => {

            const events: unknown[] = [];
            observer.on('version:mismatch', (data) => events.push(data));

            const state = { schemaVersion: 999 };

            try {

                migrateState(state);

            }
            catch {
                // Expected
            }

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                layer: 'state',
                current: 999,
                expected: CURRENT_VERSIONS.state,
            });

        });

        it('should not mutate original state', () => {

            const state = { identity: null };
            const migrated = migrateState(state);

            expect(state).not.toHaveProperty('schemaVersion');
            expect(migrated).toHaveProperty('schemaVersion');

        });

        describe('v2: per-config access roles', () => {

            it('should map protected: true to guarded access and drop protected', () => {

                const state = {
                    schemaVersion: 1,
                    configs: {
                        prod: {
                            name: 'prod',
                            protected: true,
                            connection: { dialect: 'sqlite', database: ':memory:' },
                        },
                    },
                };

                const migrated = migrateState(state);

                expect(migrated['configs']).toEqual({
                    prod: {
                        name: 'prod',
                        connection: { dialect: 'sqlite', database: ':memory:' },
                        access: { user: 'operator', mcp: 'viewer' },
                    },
                });

            });

            it('should map protected: false to open access and drop protected', () => {

                const state = {
                    schemaVersion: 1,
                    configs: {
                        dev: {
                            name: 'dev',
                            protected: false,
                            connection: { dialect: 'sqlite', database: ':memory:' },
                        },
                    },
                };

                const migrated = migrateState(state);

                expect(migrated['configs']).toEqual({
                    dev: {
                        name: 'dev',
                        connection: { dialect: 'sqlite', database: ':memory:' },
                        access: { user: 'admin', mcp: 'admin' },
                    },
                });

            });

            it('should map absent protected to open access', () => {

                const state = {
                    schemaVersion: 1,
                    configs: {
                        dev: {
                            name: 'dev',
                            connection: { dialect: 'sqlite', database: ':memory:' },
                        },
                    },
                };

                const migrated = migrateState(state);

                expect(migrated['configs']).toEqual({
                    dev: {
                        name: 'dev',
                        connection: { dialect: 'sqlite', database: ':memory:' },
                        access: { user: 'admin', mcp: 'admin' },
                    },
                });

            });

            it('should leave an already-migrated access untouched', () => {

                const state = {
                    schemaVersion: 1,
                    configs: {
                        staging: {
                            name: 'staging',
                            access: { user: 'viewer', mcp: false },
                            connection: { dialect: 'sqlite', database: ':memory:' },
                        },
                    },
                };

                const migrated = migrateState(state);

                expect(migrated['configs']).toEqual({
                    staging: {
                        name: 'staging',
                        connection: { dialect: 'sqlite', database: ':memory:' },
                        access: { user: 'viewer', mcp: false },
                    },
                });

            });

            it('should keep access when both access and legacy protected are present (access wins)', () => {

                const state = {
                    schemaVersion: 1,
                    configs: {
                        prod: {
                            name: 'prod',
                            access: { user: 'admin', mcp: 'admin' },
                            protected: true,
                            connection: { dialect: 'sqlite', database: ':memory:' },
                        },
                    },
                };

                const migrated = migrateState(state);

                expect(migrated['configs']).toEqual({
                    prod: {
                        name: 'prod',
                        connection: { dialect: 'sqlite', database: ':memory:' },
                        access: { user: 'admin', mcp: 'admin' },
                    },
                });

            });

            it('should bump schemaVersion to current', () => {

                const state = { schemaVersion: 1, configs: {} };

                const migrated = migrateState(state);

                expect(migrated['schemaVersion']).toBe(CURRENT_VERSIONS.state);

            });

            /**
             * v2 drops `protected` permanently. Anything it gets wrong here
             * cannot be reconstructed afterwards, so the binding rule is
             * that a config must never come out of it less protected than
             * it went in.
             */
            describe('fail-closed repair', () => {

                function migrateConfig(rawConfig: Record<string, unknown>): Record<string, unknown> {

                    const migrated = migrateState({ schemaVersion: 1, configs: { prod: rawConfig } });

                    return (migrated['configs'] as Record<string, Record<string, unknown>>)['prod']!;

                }

                it('should guard a config whose protected flag is a truthy non-boolean', () => {

                    // A state file written outside the zod path can hold a
                    // string here. Requiring a strict `true` sent every one
                    // of those to admin/admin — fully open.
                    expect(migrateConfig({ name: 'prod', protected: 'true' })['access'])
                        .toEqual({ user: 'operator', mcp: 'viewer' });

                    expect(migrateConfig({ name: 'prod', protected: 1 })['access'])
                        .toEqual({ user: 'operator', mcp: 'viewer' });

                });

                it('should not guard a config whose protected flag is falsy', () => {

                    expect(migrateConfig({ name: 'prod', protected: false })['access'])
                        .toEqual({ user: 'admin', mcp: 'admin' });

                });

                it('should repair an empty access instead of freezing it in', () => {

                    // `{}` is truthy, so it used to pass straight through
                    // while `protected` was discarded — leaving a config no
                    // command could ever use again and no way back.
                    expect(migrateConfig({ name: 'prod', protected: true, access: {} })['access'])
                        .toEqual({ user: 'viewer', mcp: 'viewer' });

                });

                it('should fill a half-populated access rather than persisting it', () => {

                    expect(migrateConfig({ name: 'prod', protected: true, access: { user: 'admin' } })['access'])
                        .toEqual({ user: 'admin', mcp: 'viewer' });

                });

                it('should never produce an access zod would reject', () => {

                    const malformed = [
                        { name: 'prod', protected: true, access: {} },
                        { name: 'prod', access: { user: 'admin' } },
                        { name: 'prod', access: { mcp: 'admin' } },
                        { name: 'prod', access: { user: 'superuser', mcp: 'admin' } },
                        { name: 'prod', protected: 'yes' },
                    ];

                    for (const rawConfig of malformed) {

                        const access = migrateConfig(rawConfig)['access'] as Record<string, unknown>;

                        expect({ input: rawConfig, userValid: ['viewer', 'operator', 'admin'].includes(access['user'] as string) })
                            .toEqual({ input: rawConfig, userValid: true });

                        expect({ input: rawConfig, mcpValid: access['mcp'] === false || ['viewer', 'operator', 'admin'].includes(access['mcp'] as string) })
                            .toEqual({ input: rawConfig, mcpValid: true });

                    }

                });

            });

        });

    });

    describe('createEmptyVersionedState', () => {

        it('should create state with current version', () => {

            const state = createEmptyVersionedState();

            expect(state['schemaVersion']).toBe(CURRENT_VERSIONS.state);

        });

        it('should have all required fields', () => {

            const state = createEmptyVersionedState();

            expect(state).toHaveProperty('identity');
            expect(state).toHaveProperty('knownUsers');
            expect(state).toHaveProperty('activeConfig');
            expect(state).toHaveProperty('configs');
            expect(state).toHaveProperty('secrets');
            expect(state).toHaveProperty('globalSecrets');

        });

        it('should have null for identity', () => {

            const state = createEmptyVersionedState();

            expect(state['identity']).toBeNull();

        });

        it('should have empty objects for collections', () => {

            const state = createEmptyVersionedState();

            expect(state['knownUsers']).toEqual({});
            expect(state['configs']).toEqual({});
            expect(state['secrets']).toEqual({});
            expect(state['globalSecrets']).toEqual({});

        });

    });

    describe('ensureStateVersion', () => {

        it('should migrate if needed', () => {

            const state = {};
            const result = ensureStateVersion(state);

            expect(result['schemaVersion']).toBe(CURRENT_VERSIONS.state);

        });

        it('should return same state if already current', () => {

            const state = { schemaVersion: CURRENT_VERSIONS.state };
            const result = ensureStateVersion(state);

            expect(result).toBe(state);

        });

        it('should throw for newer version', () => {

            const state = { schemaVersion: 999 };

            expect(() => ensureStateVersion(state)).toThrow(VersionMismatchError);

        });

    });

});
