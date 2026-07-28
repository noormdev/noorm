/**
 * SDK Type Surface Tests.
 *
 * Reads the built `.d.ts` (packages/sdk/dist/index.d.ts) as text to verify
 * the shipped type surface, independent of the JS bundle — types are erased
 * at runtime, so `bundle-smoke.test.ts` cannot see them.
 *
 * These tests catch:
 * - Internal setters (e.g. `_buildFn`) leaking into the public type surface
 * - Curated explore/teardown types silently dropping out of the shipped `.d.ts`
 *
 * Requires `bun run build:packages` (dts-bundle-generator) to have been run first.
 * Skipped when the `.d.ts` does not exist (e.g. CI runs `tsc` only).
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────
// Bundled Types
// ─────────────────────────────────────────────────────────────

const DTS_PATH = '../../packages/sdk/dist/index.d.ts';
const dtsExists = existsSync(new URL(DTS_PATH, import.meta.url));

// Read the built .d.ts as text — NOT imported, types have no runtime presence
const dtsContent: string = dtsExists ? readFileSync(new URL(DTS_PATH, import.meta.url), 'utf8') : '';

// ─────────────────────────────────────────────────────────────
// Internal Setter Removal
// ─────────────────────────────────────────────────────────────

describe.skipIf(!dtsExists)('sdk .d.ts: internal setter removal', () => {

    it('should not contain _buildFn anywhere in the shipped type surface', () => {

        expect(dtsContent).not.toContain('_buildFn');

    });

});

// ─────────────────────────────────────────────────────────────
// Curated Explore/Teardown Types
// ─────────────────────────────────────────────────────────────

describe.skipIf(!dtsExists)('sdk .d.ts: curated type exports', () => {

    const curatedTypes = [
        'ViewSummary',
        'ProcedureSummary',
        'FunctionSummary',
        'TypeSummary',
        'IndexSummary',
        'ForeignKeySummary',
        'ViewDetail',
        'ProcedureDetail',
        'FunctionDetail',
        'TypeDetail',
        'TruncateOptions',
        'ColumnDetail',
        'ParameterDetail',
    ] as const;

    for (const name of curatedTypes) {

        it(`should export ${name} as a top-level interface`, () => {

            expect(dtsContent).toContain(`export interface ${name}`);

        });

    }

});
