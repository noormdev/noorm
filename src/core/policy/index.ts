/**
 * Access policy module exports.
 *
 * One central policy check for every channel (CLI/TUI/SDK, MCP) and every
 * config-scoped action.
 */
export { assertPolicy, attachPolicyContext, checkConfigPolicy, checkPolicy, confirmationPhraseFor, formatAccessTag, getConfigPermission, getPolicyContext, getPolicyFingerprint, guarded, isVisibleToChannel, policyTargetIdentity, withPolicyConfirmation } from './check.js';
export { resolveChannel } from './channel.js';
export { classifyStatements } from './classify.js';
export { AGENT_HARNESSES, detectAgentHarness, isAgentSession } from './harness.js';
export type { AgentHarness } from './harness.js';
export type { SqlClass } from './classify.js';
export { DEFAULT_ACCESS, GUARDED_ACCESS, resolveLegacyAccess } from './legacy-access.js';
export { MATRIX } from './matrix.js';
export type {
    Channel,
    BuiltinRole,
    ConfigAccess,
    Permission,
    PolicyCell,
    PolicyCheck,
    PolicyContext,
    RoleDefinition,
    PolicyTarget,
    Role,
} from './types.js';
