/**
 * Settings Zod schemas and validation.
 *
 * Settings define project-wide build behavior and stage configuration.
 * Validated on load to prevent invalid configurations from being used.
 */
import { z } from 'zod';

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

/**
 * Port number validation.
 */
const PortSchema = z
    .number()
    .int()
    .min(1, 'Port must be at least 1')
    .max(65535, 'Port must be at most 65535');

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
    isTest: z.boolean().optional(),
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
    file: z.string().default('.noorm/noorm.log'),
    maxSize: FileSizeSchema.default('10mb'),
    maxFiles: z.number().int().min(1).default(5),
});

// ─────────────────────────────────────────────────────────────
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
