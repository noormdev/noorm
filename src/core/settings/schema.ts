/**
 * Settings Zod schemas and validation.
 *
 * Settings define project-wide build behavior and stage configuration.
 * Validated on load to prevent invalid configurations from being used.
 */
import { z } from 'zod';

import { PortSchema } from '../connection/defaults.js';
import { AccessSchema } from '../config/schema.js';
import { isBuiltinRole, MATRIX } from '../policy/matrix.js';
import { DEFAULT_UI_MOUSE } from './defaults.js';

// ─────────────────────────────────────────────────────────────
// Base Schemas
// ─────────────────────────────────────────────────────────────

/**
 * Valid database dialects.
 */
const DialectSchema = z.enum(['postgres', 'mysql', 'sqlite', 'mssql']);

/**
 * Secret type for CLI input handling.
 */
const SecretTypeSchema = z.enum(['string', 'password', 'api_key', 'connection_string']);

/**
 * Connection type.
 */
const ConnectionTypeSchema = z.enum(['local', 'remote']);

/**
 * Log level.
 */
const LogLevelSchema = z.enum(['silent', 'error', 'warn', 'info', 'verbose']);

export { PortSchema };

/**
 * File size pattern (e.g., '10mb', '100kb').
 */
const FileSizeSchema = z
    .string()
    .regex(/^\d+\s*(b|kb|mb|gb)$/i, 'Invalid file size format (e.g., "10mb")');

// ─────────────────────────────────────────────────────────────
// Stage Schemas
// ─────────────────────────────────────────────────────────────

/**
 * Required secret definition for a stage.
 */
const StageSecretSchema = z.object({
    key: z.string().min(1, 'Secret key is required'),
    type: SecretTypeSchema,
    description: z.string().optional(),
    required: z.boolean().default(true),
});

/**
 * Stage defaults - values applied when creating a config from this stage.
 */
const StageDefaultsSchema = z.object({
    dialect: DialectSchema.optional(),
    host: z.string().optional(),
    port: PortSchema.optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
    type: ConnectionTypeSchema.optional(),
    access: AccessSchema.optional(),
    isTest: z.boolean().optional(),
    // Settings-stage vocabulary — distinct from the removed `Config.protected`; see docs/spec/config-access-roles.md.
    protected: z.boolean().optional(),
});

/**
 * Stage definition - a preconfigured config template.
 */
const StageSchema = z.object({
    description: z.string().optional(),
    locked: z.boolean().default(false),
    defaults: StageDefaultsSchema.optional(),
    secrets: z.array(StageSecretSchema).optional(),
});

// ─────────────────────────────────────────────────────────────
// Rule Schemas
// ─────────────────────────────────────────────────────────────

/**
 * Conditions for rule matching.
 * All conditions are AND'd together.
 */
const RuleMatchSchema = z
    .object({
        name: z.string().optional(),
        // Settings-stage vocabulary — distinct from the removed `Config.protected`; matched against `guarded(config)`.
        protected: z.boolean().optional(),
        isTest: z.boolean().optional(),
        type: ConnectionTypeSchema.optional(),
    })
    .refine((match) => Object.keys(match).length > 0, {
        message: 'Rule match must specify at least one condition',
    });

/**
 * Stage-based rule for conditional include/exclude.
 */
const RuleSchema = z
    .object({
        match: RuleMatchSchema,
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
    })
    .refine((rule) => rule.include || rule.exclude, {
        message: 'Rule must specify at least one of include or exclude',
    });

// ─────────────────────────────────────────────────────────────
// Config Section Schemas
// ─────────────────────────────────────────────────────────────

/**
 * Build configuration schema.
 */
const BuildConfigSchema = z.object({
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
});

/**
 * Path configuration schema.
 */
const PathConfigSchema = z.object({
    sql: z.string().optional(),
    changes: z.string().optional(),
    pipelines: z.string().optional(),
});

/**
 * Strict mode configuration schema.
 */
const StrictConfigSchema = z.object({
    enabled: z.boolean().default(false),
    stages: z.array(z.string()).optional(),
});

/**
 * Logging configuration schema.
 */
const LoggingConfigSchema = z.object({
    enabled: z.boolean().default(true),
    level: LogLevelSchema.default('info'),
    file: z.string().default('.noorm/state/noorm.log'),
    maxSize: FileSizeSchema.default('10mb'),
    maxFiles: z.number().int().min(1).default(5),
});

// ─────────────────────────────────────────────────────────────
// Teardown Config Schema
// ─────────────────────────────────────────────────────────────

/**
 * Controls database reset and teardown behavior.
 *
 * Tables in `preserveTables` are always skipped during truncate/teardown
 * operations (in addition to noorm's internal tables).
 */
export const TeardownConfigSchema = z.object({
    preserveTables: z.array(z.string()).optional(),
    postScript: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────
// UI Config Schema
// ─────────────────────────────────────────────────────────────

/**
 * Terminal UI behaviour.
 *
 * `mouse` takes `DEFAULT_UI_MOUSE` here as well as being optional on the
 * section, so `ui: {}` in settings.yml means the same thing as no `ui` section
 * at all. Absent-section behaviour is `isMouseEnabled`'s job, off the same
 * constant.
 */
export const UiConfigSchema = z.object({
    mouse: z.boolean().default(DEFAULT_UI_MOUSE),
});

const RoleDefinitionSchema = z.object({
    extends: z.string().min(1).optional(),
    permissions: z.record(z.string(), z.enum(['allow', 'confirm', 'deny'])).optional(),
}).strict().superRefine((role, ctx) => {

    for (const permission of Object.keys(role.permissions ?? {})) {

        if (!Object.hasOwn(MATRIX, permission)) {

            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['permissions', permission],
                message: `Unknown permission "${permission}"`,
            });

        }

    }

});

const AccessSettingsSchema = z.object({
    roles: z.record(z.string().min(1), RoleDefinitionSchema).optional(),
}).strict().superRefine((access, ctx) => {

    const roles = access.roles ?? {};

    for (const [name, role] of Object.entries(roles)) {

        if (isBuiltinRole(name) && role.extends) {

            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['roles', name, 'extends'],
                message: `Built-in role "${name}" cannot extend another role`,
            });

        }
        if (role.extends && !Object.hasOwn(roles, role.extends) && !isBuiltinRole(role.extends)) {

            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['roles', name, 'extends'],
                message: `Unknown role "${role.extends}"`,
            });

        }

    }

    const visited = new Set<string>();
    for (const name of Object.keys(roles)) {

        const path = new Set<string>();
        let current: string | undefined = name;
        while (current && Object.hasOwn(roles, current) && !visited.has(current)) {

            if (path.has(current)) {

                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['roles', current, 'extends'],
                    message: `Role inheritance cycle involving "${current}"`,
                });
                break;

            }
            path.add(current);
            current = roles[current]?.extends;

        }
        for (const role of path) visited.add(role);

    }

});

// Main Settings Schema
// ─────────────────────────────────────────────────────────────

/**
 * Complete settings schema.
 */
export const SettingsSchema = z.object({
    build: BuildConfigSchema.optional(),
    paths: PathConfigSchema.optional(),
    rules: z.array(RuleSchema).optional(),
    stages: z.record(z.string(), StageSchema).optional(),
    strict: StrictConfigSchema.optional(),
    logging: LoggingConfigSchema.optional(),
    secrets: z.array(StageSecretSchema).optional(),
    teardown: TeardownConfigSchema.optional(),
    ui: UiConfigSchema.optional(),
    access: AccessSettingsSchema.optional(),
});

// ─────────────────────────────────────────────────────────────
// Type Exports
// ─────────────────────────────────────────────────────────────

export type SettingsSchemaType = z.infer<typeof SettingsSchema>;
export type StageSchemaType = z.infer<typeof StageSchema>;
export type StageDefaultsSchemaType = z.infer<typeof StageDefaultsSchema>;
export type StageSecretSchemaType = z.infer<typeof StageSecretSchema>;
export type RuleSchemaType = z.infer<typeof RuleSchema>;
export type RuleMatchSchemaType = z.infer<typeof RuleMatchSchema>;
export type BuildConfigSchemaType = z.infer<typeof BuildConfigSchema>;
export type PathConfigSchemaType = z.infer<typeof PathConfigSchema>;
export type StrictConfigSchemaType = z.infer<typeof StrictConfigSchema>;
export type LoggingConfigSchemaType = z.infer<typeof LoggingConfigSchema>;
export type UiConfigSchemaType = z.infer<typeof UiConfigSchema>;

// ─────────────────────────────────────────────────────────────
// Validation Error
// ─────────────────────────────────────────────────────────────

/**
 * Error thrown when settings validation fails.
 */
export class SettingsValidationError extends Error {

    constructor(
        message: string,
        public readonly field: string,
        public readonly issues: z.ZodIssue[],
    ) {

        super(message);
        this.name = 'SettingsValidationError';

    }

}

// ─────────────────────────────────────────────────────────────
// Validation Functions
// ─────────────────────────────────────────────────────────────

/**
 * Validate a settings object.
 *
 * @throws SettingsValidationError if validation fails
 *
 * @example
 * ```typescript
 * const [_, err] = attemptSync(() => validateSettings(settings))
 * if (err) {
 *     console.error(`Invalid settings: ${err.message}`)
 * }
 * ```
 */
export function validateSettings(settings: unknown): asserts settings is SettingsSchemaType {

    const result = SettingsSchema.safeParse(settings);

    if (!result.success) {

        const firstIssue = result.error.issues[0];

        throw new SettingsValidationError(
            firstIssue?.message ?? 'Settings validation failed',
            firstIssue?.path.join('.') || 'unknown',
            result.error.issues,
        );

    }

}

/**
 * Parse and validate settings, returning defaults for missing fields.
 *
 * @example
 * ```typescript
 * const settings = parseSettings({
 *     build: { include: ['schema'] }
 * })
 * // settings.logging.level === 'info' (default)
 * ```
 */
export function parseSettings(settings: unknown): SettingsSchemaType {

    const result = SettingsSchema.safeParse(settings);

    if (!result.success) {

        const firstIssue = result.error.issues[0];

        throw new SettingsValidationError(
            firstIssue?.message ?? 'Settings validation failed',
            firstIssue?.path.join('.') || 'unknown',
            result.error.issues,
        );

    }

    return result.data;

}

/**
 * Validate a single stage definition.
 *
 * @throws SettingsValidationError if validation fails
 */
export function validateStage(stage: unknown): asserts stage is StageSchemaType {

    const result = StageSchema.safeParse(stage);

    if (!result.success) {

        const firstIssue = result.error.issues[0];

        throw new SettingsValidationError(
            firstIssue?.message ?? 'Stage validation failed',
            firstIssue?.path.join('.') || 'unknown',
            result.error.issues,
        );

    }

}

/**
 * Validate a single rule definition.
 *
 * @throws SettingsValidationError if validation fails
 */
export function validateRule(rule: unknown): asserts rule is RuleSchemaType {

    const result = RuleSchema.safeParse(rule);

    if (!result.success) {

        const firstIssue = result.error.issues[0];

        throw new SettingsValidationError(
            firstIssue?.message ?? 'Rule validation failed',
            firstIssue?.path.join('.') || 'unknown',
            result.error.issues,
        );

    }

}
