/**
 * Agent provenance in the recorded audit identity.
 *
 * `executed_by` records who ran an operation and nothing about what was driving
 * the session, so a change applied by an agent has been indistinguishable from
 * one a human typed — which is the first question anyone asks when a migration
 * goes wrong.
 *
 * The provenance is folded into the identity string rather than given its own
 * column. The audit question is binary — "was this an agent?" — and a suffix
 * answers it against every dialect immediately, on databases whose schema
 * migration has not run. A dedicated column would be cleaner to query, but it
 * costs a four-dialect schema migration plus a window where the writing CLI and
 * the target database disagree about whether the column exists.
 *
 * This is provenance, not attestation. `executed_by` is unauthenticated free
 * text, and harness detection reads environment variables the caller owns, so
 * the suffix can be both forged and suppressed. It records what noorm observed,
 * which is the only honest claim available without signing the identity.
 *
 * @example
 * withAgentProvenance('Ann <ann@x.com>', detectAgentHarness());
 * // 'Ann <ann@x.com> (via Claude Code)'
 */
import type { AgentHarness } from '../policy/harness.js';

/**
 * Width of the `executed_by` column, from the v1 schema migration.
 *
 * Appending to a value that already nearly fills the column would turn an
 * insert that succeeds today into a hard error on postgres, mysql and mssql.
 * The identity is trimmed to make room instead, because a change that records
 * a shortened name is recoverable and one that refuses to run is not.
 */
const EXECUTED_BY_MAX_LENGTH = 255;

/**
 * Append the detected harness to an audit identity.
 *
 * Returns the identity untouched when no harness was detected, so a human's
 * record is byte-for-byte what it was before this existed.
 *
 * The identity is never parsed or escaped — it is carried verbatim ahead of the
 * suffix. An identity containing its own parentheses or angle brackets is
 * therefore preserved exactly, at the cost of being able to spell a suffix that
 * mimics this one. That trade is deliberate: mangling the operator's name to
 * defend an unauthenticated field buys nothing.
 *
 * @example
 * withAgentProvenance('Ann <ann@x.com>', null);
 * // 'Ann <ann@x.com>'
 *
 * withAgentProvenance('Ann (Platform) <ann@x.com>', { id: 'codex', name: 'OpenAI Codex', markers: [] });
 * // 'Ann (Platform) <ann@x.com> (via OpenAI Codex)'
 */
export function withAgentProvenance(executedBy: string, harness: AgentHarness | null): string {

    if (!harness) return executedBy;

    const suffix = `(via ${harness.name})`;
    const identity = executedBy.trim();

    if (!identity) return suffix;

    // Reserve the separating space alongside the suffix.
    const room = EXECUTED_BY_MAX_LENGTH - suffix.length - 1;

    // A harness named long enough to fill the column on its own would leave the
    // identity nowhere to go; keeping the identity is the better half to save.
    if (room <= 0) return identity;

    return `${identity.slice(0, room).trimEnd()} ${suffix}`;

}
