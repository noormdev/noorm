/**
 * SDK Bundle Smoke Tests.
 *
 * Imports from the built bundle (packages/sdk/dist) to verify
 * that the published package loads without missing dependencies,
 * exports the expected API surface, and basic operations work.
 *
 * These tests catch:
 * - Missing bundled dependencies (e.g. json5, yaml, zod)
 * - Broken re-exports or missing symbols
 * - Runtime initialization errors from module-level side effects
 *
 * Requires `scripts/build.mjs` to have been run first (tsup bundle).
 * Skipped when dist does not exist (e.g. CI runs `tsc` only).
 */
import { describe, it, expect } from 'bun:test';
import { existsSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────
// Bundle Import
// ─────────────────────────────────────────────────────────────

const BUNDLE_PATH = '../../packages/sdk/dist/index.js';
const bundleExists = existsSync(new URL(BUNDLE_PATH, import.meta.url));

// Import from built bundle — NOT from source
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bundle: any = bundleExists ? await import(BUNDLE_PATH) : {};

// ─────────────────────────────────────────────────────────────
// Module Loading
// ─────────────────────────────────────────────────────────────

describe.skipIf(!bundleExists)('sdk bundle: module loading', () => {

    it('should import the bundle without errors', () => {

        expect(bundle).toBeDefined();

    });

    it('should not export undefined values', () => {

        const undefinedExports = Object.entries(bundle)
            .filter(([, value]) => value === undefined)
            .map(([key]) => key);

        expect(undefinedExports).toEqual([]);

    });

});

// ─────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────

describe.skipIf(!bundleExists)('sdk bundle: createContext', () => {

    it('should export createContext as a function', () => {

        expect(typeof bundle.createContext).toBe('function');

    });

});

// ─────────────────────────────────────────────────────────────
// Core Classes
// ─────────────────────────────────────────────────────────────

describe.skipIf(!bundleExists)('sdk bundle: core classes', () => {

    it('should export Context class', () => {

        expect(typeof bundle.Context).toBe('function');

    });

    it('should export NoormOps class', () => {

        expect(typeof bundle.NoormOps).toBe('function');

    });

});

// ─────────────────────────────────────────────────────────────
// Namespace Classes
// ─────────────────────────────────────────────────────────────

describe.skipIf(!bundleExists)('sdk bundle: namespace classes', () => {

    const namespaces = [
        'ChangesNamespace',
        'RunNamespace',
        'DbNamespace',
        'LockNamespace',
        'VaultNamespace',
        'SecretsNamespace',
        'TemplatesNamespace',
        'TransferNamespace',
        'DtNamespace',
        'UtilsNamespace',
    ] as const;

    for (const name of namespaces) {

        it(`should export ${name}`, () => {

            expect(typeof bundle[name]).toBe('function');

        });

    }

});

// ─────────────────────────────────────────────────────────────
// Error Classes
// ─────────────────────────────────────────────────────────────

describe.skipIf(!bundleExists)('sdk bundle: error classes', () => {

    it('should export RequireTestError', () => {

        expect(typeof bundle.RequireTestError).toBe('function');

    });

    it('should export ProtectedConfigError', () => {

        expect(typeof bundle.ProtectedConfigError).toBe('function');

    });

    it('should export change error classes', () => {

        expect(typeof bundle.ChangeValidationError).toBe('function');
        expect(typeof bundle.ChangeNotFoundError).toBe('function');
        expect(typeof bundle.ChangeAlreadyAppliedError).toBe('function');
        expect(typeof bundle.ChangeNotAppliedError).toBe('function');
        expect(typeof bundle.ChangeOrphanedError).toBe('function');
        expect(typeof bundle.ManifestReferenceError).toBe('function');

    });

    it('should export lock error classes', () => {

        expect(typeof bundle.LockAcquireError).toBe('function');
        expect(typeof bundle.LockExpiredError).toBe('function');

    });

    it('RequireTestError should be instanceof Error', () => {

        const err = new bundle.RequireTestError('test-config');

        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('RequireTestError');
        expect(err.configName).toBe('test-config');

    });

    it('ProtectedConfigError should be instanceof Error', () => {

        const err = new bundle.ProtectedConfigError('prod', 'truncate');

        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('ProtectedConfigError');
        expect(err.configName).toBe('prod');
        expect(err.operation).toBe('truncate');

    });

});

// ─────────────────────────────────────────────────────────────
// Context Instantiation (no DB required)
// ─────────────────────────────────────────────────────────────

describe.skipIf(!bundleExists)('sdk bundle: Context instantiation', () => {

    function createBundleContext() {

        return new bundle.Context(
            {
                name: 'smoke-test',
                type: 'local',
                isTest: true,
                access: { user: 'admin', mcp: 'admin' },
                connection: { dialect: 'postgres', database: 'smokedb' },
            },
            {},
            { name: 'smoke-tester', source: 'system' },
            {},
            '/tmp/sdk-smoke-test',
        );

    }

    it('should instantiate Context from bundle', () => {

        const ctx = createBundleContext();

        expect(ctx).toBeInstanceOf(bundle.Context);

    });

    it('should expose dialect', () => {

        const ctx = createBundleContext();

        expect(ctx.dialect).toBe('postgres');

    });

    it('should expose connected as false', () => {

        const ctx = createBundleContext();

        expect(ctx.connected).toBe(false);

    });

    it('should throw on kysely access when not connected', () => {

        const ctx = createBundleContext();

        expect(() => ctx.kysely).toThrow('Not connected');

    });

    it('should expose noorm namespace', () => {

        const ctx = createBundleContext();

        expect(ctx.noorm).toBeInstanceOf(bundle.NoormOps);

    });

    it('should expose noorm.config', () => {

        const ctx = createBundleContext();

        expect(ctx.noorm.config.name).toBe('smoke-test');
        expect(ctx.noorm.config.connection.dialect).toBe('postgres');

    });

    it('should expose noorm.identity', () => {

        const ctx = createBundleContext();

        expect(ctx.noorm.identity.name).toBe('smoke-tester');

    });

    it('should expose noorm.observer', () => {

        const ctx = createBundleContext();

        expect(typeof ctx.noorm.observer.on).toBe('function');
        expect(typeof ctx.noorm.observer.emit).toBe('function');

    });

    it('should lazily create all namespace instances', () => {

        const ctx = createBundleContext();

        expect(ctx.noorm.changes).toBeInstanceOf(bundle.ChangesNamespace);
        expect(ctx.noorm.run).toBeInstanceOf(bundle.RunNamespace);
        expect(ctx.noorm.db).toBeInstanceOf(bundle.DbNamespace);
        expect(ctx.noorm.lock).toBeInstanceOf(bundle.LockNamespace);
        expect(ctx.noorm.vault).toBeInstanceOf(bundle.VaultNamespace);
        expect(ctx.noorm.secrets).toBeInstanceOf(bundle.SecretsNamespace);
        expect(ctx.noorm.templates).toBeInstanceOf(bundle.TemplatesNamespace);
        expect(ctx.noorm.transfer).toBeInstanceOf(bundle.TransferNamespace);
        expect(ctx.noorm.dt).toBeInstanceOf(bundle.DtNamespace);
        expect(ctx.noorm.utils).toBeInstanceOf(bundle.UtilsNamespace);

    });

});

// ─────────────────────────────────────────────────────────────
// Dynamic Dialect Chunks
// ─────────────────────────────────────────────────────────────

describe.skipIf(!bundleExists)('sdk bundle: dialect chunks', () => {

    const dialects = ['postgres', 'mysql', 'mssql', 'sqlite'] as const;

    for (const dialect of dialects) {

        it(`should instantiate Context with ${dialect} dialect`, () => {

            const ctx = new bundle.Context(
                {
                    name: `${dialect}-test`,
                    type: 'local',
                    isTest: true,
                    access: { user: 'admin', mcp: 'admin' },
                    connection: { dialect, database: `${dialect}db` },
                },
                {},
                { name: 'tester', source: 'system' },
                {},
                '/tmp/sdk-smoke-test',
            );

            expect(ctx.dialect).toBe(dialect);

        });

    }

});
