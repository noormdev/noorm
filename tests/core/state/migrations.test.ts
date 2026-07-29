/**
 * Package-semver state migration tests.
 *
 * `migrateState`/`needsMigration` in src/core/state/migrations.ts are the
 * package-version layer, distinct from the schemaVersion layer in
 * core/version/state. Until now this layer had no direct test at all.
 */
import { describe, it, expect } from 'bun:test';
import { migrateState, needsMigration } from '../../../src/core/state/migrations.js';

const VERSION = '9.9.9';

/**
 * A state record already at the current package version, shaped exactly
 * like what `migrateState` itself produces.
 */
function currentState(): Record<string, unknown> {

    return {
        version: VERSION,
        schemaVersion: 2,
        knownUsers: {},
        activeConfig: null,
        configs: {},
        secrets: {},
        globalSecrets: {},
    };

}

describe('state: migrations', () => {

    describe('needsMigration', () => {

        it('should converge: migrateState output must not need migrating again', () => {

            // The predicate and the transform must agree, or every load
            // becomes a write. Feeding the transform's own output back in
            // is the property that catches a predicate testing for a field
            // the transform never writes.
            const once = migrateState({ version: '0.0.1' }, VERSION);
            const twice = migrateState(once, VERSION);

            expect(needsMigration(once, VERSION)).toBe(false);
            expect(needsMigration(twice, VERSION)).toBe(false);

        });

        it('should not flag a state already at the current version', () => {

            expect(needsMigration(currentState(), VERSION)).toBe(false);

        });

        it('should flag a version mismatch', () => {

            expect(needsMigration({ ...currentState(), version: '0.0.1' }, VERSION)).toBe(true);

        });

        it('should flag missing required fields', () => {

            const { globalSecrets: _g, ...noGlobalSecrets } = currentState();
            const { knownUsers: _k, ...noKnownUsers } = currentState();

            expect(needsMigration(noGlobalSecrets, VERSION)).toBe(true);
            expect(needsMigration(noKnownUsers, VERSION)).toBe(true);

        });

        it('should flag a non-object state', () => {

            expect(needsMigration(null, VERSION)).toBe(true);
            expect(needsMigration('nonsense', VERSION)).toBe(true);

        });

    });

    describe('migrateState', () => {

        it('should be idempotent', () => {

            const once = migrateState({ version: '0.0.1', configs: { dev: { name: 'dev' } } }, VERSION);
            const twice = migrateState(once, VERSION);

            expect(twice).toEqual(once);

        });

        it('should preserve unknown top-level fields written by a newer version', () => {

            // A newer binary may add top-level fields this build knows
            // nothing about. Dropping them here is silent data loss,
            // because the truncated object is persisted straight back.
            const migrated = migrateState(
                { ...currentState(), version: '0.0.1', auditTrail: ['future-field'] },
                VERSION,
            );

            expect(migrated).toHaveProperty('auditTrail', ['future-field']);

        });

        it('should drop a legacy top-level identity rather than carrying it', () => {

            // Identity moved to ~/.noorm/; pre-move state files hold key
            // material here, so carrying it forward would keep a private
            // key inside state.enc indefinitely.
            const migrated = migrateState(
                { ...currentState(), version: '0.0.1', identity: { privateKey: 'deadbeef' } },
                VERSION,
            );

            expect(migrated).not.toHaveProperty('identity');

        });

        it('should still normalise the fields it owns', () => {

            const migrated = migrateState({ version: '0.0.1' }, VERSION);

            expect(migrated.version).toBe(VERSION);
            expect(migrated.knownUsers).toEqual({});
            expect(migrated.activeConfig).toBeNull();
            expect(migrated.configs).toEqual({});
            expect(migrated.secrets).toEqual({});
            expect(migrated.globalSecrets).toEqual({});

        });

        it('should carry schemaVersion through untouched', () => {

            expect(migrateState({ schemaVersion: 2 }, VERSION).schemaVersion).toBe(2);
            expect(migrateState({}, VERSION).schemaVersion).toBe(0);

        });

        it('should reject a non-object state', () => {

            expect(() => migrateState(null, VERSION)).toThrow('Invalid state format');

        });

    });

});
