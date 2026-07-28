/**
 * Settings form validation utilities.
 *
 * Shared validators for stage-defaults fields used by
 * SettingsStageEditScreen.
 *
 * @example
 * ```typescript
 * const error = validateStagePort('99999');
 * ```
 */
import { PortSchema } from '../../core/settings/schema.js';

/**
 * Validates a stage-default port number string.
 *
 * Returns undefined for empty/missing values (the field is optional).
 * Delegates the bound check to the settings `PortSchema` — the same
 * schema that validates `StageDefaults.port` at save time — so the
 * live-form validator can never drift from what's actually enforced.
 *
 * @example
 * ```typescript
 * validate: (value) => validateStagePort(typeof value === 'string' ? value : undefined)
 * ```
 */
export function validateStagePort(value: string | undefined): string | undefined {

    if (!value) return undefined;

    const port = parseInt(value, 10);

    if (isNaN(port)) {

        return 'Port must be 1-65535';

    }

    const result = PortSchema.safeParse(port);

    if (!result.success) {

        return result.error.issues[0]?.message ?? 'Invalid port';

    }

    return undefined;

}
