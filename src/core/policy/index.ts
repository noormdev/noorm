/**
 * Access policy module exports.
 *
 * One central policy check for every channel (CLI/TUI/SDK, MCP) and every
 * config-scoped action.
 */
export { assertPolicy, checkConfigPolicy, checkPolicy, confirmationPhraseFor, formatAccessTag, guarded } from './check.js';
export { classifyStatements } from './classify.js';
export type { SqlClass } from './classify.js';
export { GUARDED_ACCESS, OPEN_ACCESS, resolveLegacyAccess } from './legacy-access.js';
export { MATRIX } from './matrix.js';
export type {
    Channel,
    ConfigAccess,
    Permission,
    PolicyCell,
    PolicyCheck,
    PolicyTarget,
    Role,
} from './types.js';
