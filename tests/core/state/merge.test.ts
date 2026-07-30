/**
 * Three-way state reconciliation tests.
 *
 * The rule under test is "our edits win only where we actually edited" —
 * anything weaker either loses a concurrent writer's data or resurrects
 * something someone deliberately deleted.
 */
import { describe, it, expect } from 'bun:test';
import { mergeState } from '../../../src/core/state/merge.js';
import type { State } from '../../../src/core/state/types.js';
import type { Config } from '../../../src/core/config/types.js';

function config(name: string): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

}

function state(overrides: Partial<State> = {}): State {

    return {
        version: '1.0.0',
        schemaVersion: 2,
        knownUsers: {},
        activeConfig: null,
        configs: {},
        secrets: {},
        globalSecrets: {},
        ...overrides,
    };

}

describe('state: merge', () => {

    it('should keep both sides of a concurrent add', () => {

        const baseline = state();
        const merged = mergeState(
            baseline,
            state({ globalSecrets: { OURS: 'a' } }),
            state({ globalSecrets: { THEIRS: 'b' } }),
        );

        expect(merged.globalSecrets).toEqual({ OURS: 'a', THEIRS: 'b' });

    });

    it('should keep both sides of a concurrent add to the same config secrets', () => {

        // The reported failure: parallel `secret set` calls against one
        // config. A merge at the config level only would drop a sibling key.
        const baseline = state({ secrets: { dev: {} } });
        const merged = mergeState(
            baseline,
            state({ secrets: { dev: { OURS: 'a' } } }),
            state({ secrets: { dev: { THEIRS: 'b' } } }),
        );

        expect(merged.secrets['dev']).toEqual({ OURS: 'a', THEIRS: 'b' });

    });

    it('should honour our delete against their untouched copy', () => {

        const baseline = state({ configs: { dev: config('dev') } });
        const merged = mergeState(
            baseline,
            state(),
            state({ configs: { dev: config('dev') } }),
        );

        expect(merged.configs).toEqual({});

    });

    it('should not resurrect what they deleted', () => {

        const baseline = state({ configs: { dev: config('dev') } });
        const merged = mergeState(
            baseline,
            state({ configs: { dev: config('dev') }, globalSecrets: { OURS: 'a' } }),
            state(),
        );

        expect(merged.configs).toEqual({});
        expect(merged.globalSecrets).toEqual({ OURS: 'a' });

    });

    it('should prefer our edit over theirs on the same key', () => {

        const baseline = state({ globalSecrets: { K: 'original' } });
        const merged = mergeState(
            baseline,
            state({ globalSecrets: { K: 'ours' } }),
            state({ globalSecrets: { K: 'theirs' } }),
        );

        expect(merged.globalSecrets['K']).toBe('ours');

    });

    it('should take their edit on a key we never touched', () => {

        const baseline = state({ globalSecrets: { K: 'original' } });
        const merged = mergeState(
            baseline,
            state({ globalSecrets: { K: 'original' } }),
            state({ globalSecrets: { K: 'theirs' } }),
        );

        expect(merged.globalSecrets['K']).toBe('theirs');

    });

    it('should keep their activeConfig when we did not change it', () => {

        const baseline = state({ activeConfig: 'dev' });
        const merged = mergeState(
            baseline,
            state({ activeConfig: 'dev' }),
            state({ activeConfig: 'prod' }),
        );

        expect(merged.activeConfig).toBe('prod');

    });

    it('should keep our activeConfig when we changed it', () => {

        const baseline = state({ activeConfig: 'dev' });
        const merged = mergeState(
            baseline,
            state({ activeConfig: 'staging' }),
            state({ activeConfig: 'prod' }),
        );

        expect(merged.activeConfig).toBe('staging');

    });

    it('should never step schemaVersion backwards', () => {

        const merged = mergeState(
            state({ schemaVersion: 2 }),
            state({ schemaVersion: 2 }),
            state({ schemaVersion: 7 }),
        );

        expect(merged.schemaVersion).toBe(7);

    });

    it('should carry through an unknown top-level field only one side has', () => {

        const baseline = state();
        const theirs = { ...state(), auditTrail: ['theirs'] } as State;

        const merged = mergeState(baseline, state(), theirs) as unknown as Record<string, unknown>;

        expect(merged['auditTrail']).toEqual(['theirs']);

    });

});
