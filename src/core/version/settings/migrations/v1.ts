/**
 * Settings Migration v1 - Initial settings shape.
 *
 * Defines the baseline settings structure. This migration ensures
 * all optional sections have sensible defaults when present.
 *
 * For settings schema documentation, see src/core/settings/types.ts
 */
import type { SettingsMigration } from '../../types.js'


/**
 * Migration v1: Initial settings shape.
 *
 * Adds schemaVersion field and ensures structure matches expected format.
 * Settings fields are all optional, so we just ensure the version exists.
 *
 * Fields (all optional):
 * - schemaVersion: number (settings schema version)
 * - build: BuildConfig
 * - paths: PathConfig
 * - rules: Rule[]
 * - stages: Record<string, Stage>
 * - strict: StrictConfig
 * - logging: LoggingConfig
 */
export const v1: SettingsMigration = {

    version: 1,
    description: 'Initial settings shape',

    up(settings: Record<string, unknown>): Record<string, unknown> {

        return {
            schemaVersion: 1,
            ...settings,
        }
    },

    down(settings: Record<string, unknown>): Record<string, unknown> {

        // v1 is the baseline - can't downgrade further
        // Remove schemaVersion and return raw settings
        const { schemaVersion, ...rest } = settings
        return rest
    },
}
