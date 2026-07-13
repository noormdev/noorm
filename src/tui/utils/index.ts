/**
 * CLI utilities barrel export.
 */
export { copyToClipboard, isClipboardAvailable } from './clipboard.js';
export { toKebabCase } from './string.js';
export { resolveChangesDir, resolveSqlDir } from './paths.js';
export { resolveScreenIdentity } from './identity.js';
export { createChangeManager, type CreateChangeManagerOptions } from './change-context.js';
export { buildRunContext, type BuildRunContextOptions } from './run-context.js';
export { withScreenConnection } from './connection.js';
export {
    loadChangesWithStatus,
    buildPendingChangeList,
    buildAppliedChangeList,
    buildMergedChangeList,
    type ChangesWithStatus,
} from './change-loader.js';
export {
    validateConfigName,
    validatePort,
    buildConnectionConfig,
    buildAccessFromValues,
    isConfigGuarded,
    DEFAULT_PORTS,
    USER_ROLE_OPTIONS,
    MCP_ROLE_OPTIONS,
    type ConnectionDefaults,
} from './config-validation.js';
export { getErrorMessage } from './error.js';
export { validateStagePort } from './settings-validation.js';
