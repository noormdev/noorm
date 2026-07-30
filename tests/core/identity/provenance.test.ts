/**
 * Unit tests for agent provenance in the audit identity.
 *
 * WHY the format is asserted literally rather than via a helper: the suffix is
 * the entire audit signal, and anyone asking "did an agent do this?" months
 * from now will do it with a `LIKE '%(via %'` against rows already written.
 * Changing the shape silently orphans every record that came before, so the
 * spelling is pinned here on purpose and a failure means a migration decision,
 * not a test to update.
 *
 * Harnesses come from `detectAgentHarness` over a literal env rather than a
 * hand-built object, so the names that reach the database are the shipped ones
 * — a rename in `AGENT_HARNESSES` has to surface here.
 */
import { describe, it, expect } from 'bun:test';

import { withAgentProvenance } from '../../../src/core/identity/provenance.js';
import { detectAgentHarness } from '../../../src/core/policy/harness.js';

const CLAUDE = detectAgentHarness({ CLAUDECODE: '1' })!;
const CODEX = detectAgentHarness({ CODEX_SANDBOX: 'seatbelt' })!;

describe('identity: withAgentProvenance', () => {

    it('should leave the identity untouched when no harness was detected', () => {

        // A human-driven record has to stay byte-for-byte what it was before
        // provenance existed, or every pre-existing row reads as a change.
        expect(withAgentProvenance('Ann <ann@x.com>', null)).toBe('Ann <ann@x.com>');
        expect(withAgentProvenance('', null)).toBe('');

    });

    it('should append the harness name in the documented shape', () => {

        expect(withAgentProvenance('Ann <ann@x.com>', CLAUDE)).toBe('Ann <ann@x.com> (via Claude Code)');
        expect(withAgentProvenance('Ann <ann@x.com>', CODEX)).toBe('Ann <ann@x.com> (via OpenAI Codex)');

    });

    it('should name the specific harness rather than a generic agent flag', () => {

        // The audit answer "an agent" is far less useful than "which one", and
        // the allowlist is ordered so a specific marker wins over AI_AGENT.
        expect(withAgentProvenance('Ann', CLAUDE)).not.toContain('AI agent');
        expect(withAgentProvenance('Ann', CLAUDE)).toContain('Claude Code');

    });

    it('should carry an identity containing brackets or parens through verbatim', () => {

        // `executed_by` is free text and a real NOORM_IDENTITY can hold both.
        // Escaping or stripping them would corrupt the human attribution, which
        // is the field's primary job.
        const identity = 'Ann (Platform) <ann@x.com>';

        expect(withAgentProvenance(identity, CLAUDE)).toBe('Ann (Platform) <ann@x.com> (via Claude Code)');

        const adversarial = 'CSO <cso@corp> (via Claude Code)';

        // Already spelling the suffix does not corrupt the value or collapse
        // the two — it is unauthenticated free text, and the honest record is
        // what was actually submitted plus what noorm actually observed.
        expect(withAgentProvenance(adversarial, CLAUDE)).toBe('CSO <cso@corp> (via Claude Code) (via Claude Code)');

    });

    it('should record the harness alone when there is no identity to qualify', () => {

        // `executed_by` defaults to '' in the schema, so an empty identity is a
        // real case and must not produce a leading space.
        expect(withAgentProvenance('', CLAUDE)).toBe('(via Claude Code)');
        expect(withAgentProvenance('   ', CLAUDE)).toBe('(via Claude Code)');

    });

    it('should keep the result inside the executed_by column width', () => {

        // The column is varchar(255). Appending blindly would turn an insert
        // that succeeds today into a hard error on postgres, mysql and mssql —
        // a provenance nicety must never be able to fail a migration.
        const long = 'N'.repeat(250);
        const result = withAgentProvenance(long, CLAUDE);

        expect(result.length).toBeLessThanOrEqual(255);
        expect(result).toEndWith('(via Claude Code)');

    });

    it('should preserve as much of an over-long identity as the suffix allows', () => {

        const long = `${'N'.repeat(300)} <ann@x.com>`;
        const result = withAgentProvenance(long, CLAUDE);

        expect(result.length).toBe(255);
        expect(result).toStartWith('NNNN');
        expect(result).toEndWith(' (via Claude Code)');

    });

});
