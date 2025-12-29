/**
 * Tests for unified version manager.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';

import { observer } from '../../../src/core/observer.js';
import { CURRENT_VERSIONS, VersionMismatchError } from '../../../src/core/version/types.js';
import type { NoormDatabase } from '../../../src/core/version/schema/tables.js';
import {
    VersionManager,
    getVersionManager,
    resetVersionManager,
} from '../../../src/core/version/index.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';

describe('version: manager', () => {

    let db: Kysely<NoormDatabase>;

    beforeEach(() => {

        observer.clear();
        resetVersionManager();

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new Database(':memory:'),
            }),
        });

    });

    afterEach(async () => {

        await db.destroy();

    });

    describe('VersionManager', () => {

        it('should store project root', () => {

            const manager = new VersionManager({ projectRoot: '/test/path' });

            expect(manager.projectRoot).toBe('/test/path');

        });

        describe('check', () => {

            it('should return status for all layers', async () => {

                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                const status = await manager.check(db, state, settings);

                expect(status).toHaveProperty('schema');
                expect(status).toHaveProperty('state');
                expect(status).toHaveProperty('settings');

            });

            it('should detect schema migration needed', async () => {

                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                const status = await manager.check(db, state, settings);

                expect(status.schema.needsMigration).toBe(true);
                expect(status.schema.current).toBe(0);

            });

            it('should detect state migration needed', async () => {

                await bootstrapSchema(db, '1.0.0');
                const manager = new VersionManager({ projectRoot: '/test' });
                const state = {};
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                const status = await manager.check(db, state, settings);

                expect(status.state.needsMigration).toBe(true);
                expect(status.state.current).toBe(0);

            });

            it('should detect settings migration needed', async () => {

                await bootstrapSchema(db, '1.0.0');
                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = {};

                const status = await manager.check(db, state, settings);

                expect(status.settings.needsMigration).toBe(true);
                expect(status.settings.current).toBe(0);

            });

            it('should detect all current versions', async () => {

                await bootstrapSchema(db, '1.0.0');
                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                const status = await manager.check(db, state, settings);

                expect(status.schema.needsMigration).toBe(false);
                expect(status.state.needsMigration).toBe(false);
                expect(status.settings.needsMigration).toBe(false);

            });

        });

        describe('ensureCompatible', () => {

            it('should migrate all layers', async () => {

                const manager = new VersionManager({ projectRoot: '/test' });
                const state = {};
                const settings = {};

                const result = await manager.ensureCompatible(db, state, settings, '1.0.0');

                expect(result.state['schemaVersion']).toBe(CURRENT_VERSIONS.state);
                expect(result.settings['schemaVersion']).toBe(CURRENT_VERSIONS.settings);

            });

            it('should return migrated state', async () => {

                await bootstrapSchema(db, '1.0.0');
                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { identity: { name: 'test' } };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                const result = await manager.ensureCompatible(db, state, settings, '1.0.0');

                expect(result.state['identity']).toEqual({ name: 'test' });
                expect(result.state['schemaVersion']).toBe(CURRENT_VERSIONS.state);

            });

            it('should return migrated settings', async () => {

                await bootstrapSchema(db, '1.0.0');
                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { build: { include: ['schema'] } };

                const result = await manager.ensureCompatible(db, state, settings, '1.0.0');

                expect(result.settings['build']).toEqual({ include: ['schema'] });
                expect(result.settings['schemaVersion']).toBe(CURRENT_VERSIONS.settings);

            });

            it('should throw for newer schema version', async () => {

                await bootstrapSchema(db, '1.0.0');
                await db.updateTable('__noorm_version__').set({ schema_version: 999 }).execute();

                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                await expect(
                    manager.ensureCompatible(db, state, settings, '1.0.0'),
                ).rejects.toThrow(VersionMismatchError);

            });

            it('should throw for newer state version', async () => {

                await bootstrapSchema(db, '1.0.0');
                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: 999 };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                await expect(
                    manager.ensureCompatible(db, state, settings, '1.0.0'),
                ).rejects.toThrow(VersionMismatchError);

            });

            it('should throw for newer settings version', async () => {

                await bootstrapSchema(db, '1.0.0');
                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { schemaVersion: 999 };

                await expect(
                    manager.ensureCompatible(db, state, settings, '1.0.0'),
                ).rejects.toThrow(VersionMismatchError);

            });

        });

        describe('needsMigration', () => {

            it('should return true when any layer needs migration', async () => {

                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                // Schema needs migration (no tables)
                const needs = await manager.needsMigration(db, state, settings);

                expect(needs).toBe(true);

            });

            it('should return false when all layers are current', async () => {

                await bootstrapSchema(db, '1.0.0');
                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                const needs = await manager.needsMigration(db, state, settings);

                expect(needs).toBe(false);

            });

        });

        describe('hasNewerVersion', () => {

            it('should return true when any layer is newer', async () => {

                await bootstrapSchema(db, '1.0.0');
                await db.updateTable('__noorm_version__').set({ schema_version: 999 }).execute();

                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                const hasNewer = await manager.hasNewerVersion(db, state, settings);

                expect(hasNewer).toBe(true);

            });

            it('should return false when no layer is newer', async () => {

                await bootstrapSchema(db, '1.0.0');
                const manager = new VersionManager({ projectRoot: '/test' });
                const state = { schemaVersion: CURRENT_VERSIONS.state };
                const settings = { schemaVersion: CURRENT_VERSIONS.settings };

                const hasNewer = await manager.hasNewerVersion(db, state, settings);

                expect(hasNewer).toBe(false);

            });

        });

    });

    describe('getVersionManager', () => {

        it('should return singleton instance', () => {

            const manager1 = getVersionManager('/test');
            const manager2 = getVersionManager('/other');

            expect(manager1).toBe(manager2);

        });

        it('should use provided project root', () => {

            const manager = getVersionManager('/my/project');

            expect(manager.projectRoot).toBe('/my/project');

        });

        it('should use cwd if no project root provided', () => {

            const manager = getVersionManager();

            expect(manager.projectRoot).toBe(process.cwd());

        });

    });

    describe('resetVersionManager', () => {

        it('should clear singleton instance', () => {

            const manager1 = getVersionManager('/path1');
            resetVersionManager();
            const manager2 = getVersionManager('/path2');

            expect(manager1).not.toBe(manager2);
            expect(manager2.projectRoot).toBe('/path2');

        });

    });

});
