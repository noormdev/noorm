/**
 * SQL Terminal module.
 *
 * Provides SQL REPL functionality with history management.
 */

export * from './types.js';
export * from './history.js';

/**
 * `executeRawSqlUnchecked` is deliberately absent from this barrel: it runs
 * arbitrary SQL with no policy gate, and a barrel is exactly how an ungated
 * symbol ends up one autocomplete away from a production call site. The
 * tests that legitimately need it import `./executor.js` directly.
 */
export { executeRawSql } from './executor.js';
export type { SqlPolicyGate } from './executor.js';
