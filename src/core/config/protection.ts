/**
 * Protected config handling.
 *
 * Protected configs require confirmation for destructive operations.
 * Some operations (like db:destroy) are completely blocked.
 */
import { shouldSkipConfirmations } from '../environment.js';
import type { Config } from './types.js';

/**
 * Actions that can be performed on configs.
 */
export type ProtectedAction =
    | 'change:run'
    | 'change:revert'
    | 'change:ff'
    | 'change:next'
    | 'run:build'
    | 'run:file'
    | 'run:dir'
    | 'db:create'
    | 'db:destroy'
    | 'config:rm';

/**
 * Actions that are completely blocked on protected configs.
 */
const BLOCKED_ACTIONS: ProtectedAction[] = ['db:destroy'];

/**
 * Actions that require confirmation on protected configs.
 */
const CONFIRM_ACTIONS: ProtectedAction[] = [
    'change:run',
    'change:revert',
    'change:ff',
    'change:next',
    'run:build',
    'run:file',
    'run:dir',
    'db:create',
    'config:rm',
];

/**
 * Result of checking protection for an action.
 */
export interface ProtectionCheck {
    /** Whether the action is allowed to proceed */
    allowed: boolean;

    /** Whether user confirmation is needed before proceeding */
    requiresConfirmation: boolean;

    /** The phrase user must type to confirm (e.g., "yes-production") */
    confirmationPhrase?: string;

    /** Reason the action is blocked (if not allowed) */
    blockedReason?: string;
}

/**
 * Check if an action is allowed on a config.
 *
 * For protected configs:
 * - Some actions are completely blocked (e.g., db:destroy)
 * - Some actions require user confirmation
 * - Confirmation can be skipped with NOORM_YES=1
 *
 * @example
 * ```typescript
 * const check = checkProtection(config, 'change:run')
 *
 * if (!check.allowed) {
 *     console.error(check.blockedReason)
 *     process.exit(1)
 * }
 *
 * if (check.requiresConfirmation) {
 *     const input = await prompt(`Type "${check.confirmationPhrase}" to confirm:`)
 *     if (input !== check.confirmationPhrase) {
 *         console.error('Confirmation failed')
 *         process.exit(1)
 *     }
 * }
 *
 * // Proceed with action...
 * ```
 */
export function checkProtection(config: Config, action: ProtectedAction): ProtectionCheck {

    // Non-protected configs allow everything
    if (!config.protected) {

        return { allowed: true, requiresConfirmation: false };

    }

    // Blocked actions
    if (BLOCKED_ACTIONS.includes(action)) {

        return {
            allowed: false,
            requiresConfirmation: false,
            blockedReason:
                `"${action}" is not allowed on protected config "${config.name}". ` +
                'Connect to the database directly to perform this action.',
        };

    }

    // Actions requiring confirmation
    if (CONFIRM_ACTIONS.includes(action)) {

        // Skip confirmation if NOORM_YES is set (for scripted CI)
        if (shouldSkipConfirmations()) {

            return { allowed: true, requiresConfirmation: false };

        }

        return {
            allowed: true,
            requiresConfirmation: true,
            confirmationPhrase: `yes-${config.name}`,
        };

    }

    // Unknown action - allow by default
    return { allowed: true, requiresConfirmation: false };

}

/**
 * Validate a confirmation phrase.
 *
 * The expected phrase is "yes-{configName}".
 *
 * @example
 * ```typescript
 * const valid = validateConfirmation(config, userInput)
 * if (!valid) {
 *     console.error('Invalid confirmation')
 * }
 * ```
 */
export function validateConfirmation(config: Config, input: string): boolean {

    return input === `yes-${config.name}`;

}
