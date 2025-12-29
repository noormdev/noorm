/**
 * Configuration Zod schemas and validation.
 *
 * Uses Zod for declarative validation with better error messages
 * and type inference.
 */
import { z } from 'zod';

/**
 * Valid database dialects.
 */
export const DialectSchema = z.enum(['postgres', 'mysql', 'sqlite', 'mssql']);

/**
 * Config name pattern - alphanumeric with hyphens and underscores.
 */
const ConfigNameSchema = z
    .string()
    .min(1, 'Config name is required')
    .regex(
        /^[a-z0-9_-]+$/i,
        'Config name must contain only letters, numbers, hyphens, and underscores',
    );

/**
 * Port number validation.
 */
const PortSchema = z
    .number()
    .int()
    .min(1, 'Port must be at least 1')
    .max(65535, 'Port must be at most 65535');

/**
 * Connection pool configuration.
 */
const PoolSchema = z.object({
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(1).optional(),
});

/**
 * SSL configuration - can be boolean or detailed config.
 */
const SSLSchema = z.union([
    z.boolean(),
    z.object({
        rejectUnauthorized: z.boolean().optional(),
        ca: z.string().optional(),
        cert: z.string().optional(),
        key: z.string().optional(),
    }),
]);

/**
 * Connection configuration schema.
 *
 * SQLite only requires dialect + database (or filename).
 * Other dialects require host.
 */
export const ConnectionSchema = z
    .object({
        dialect: DialectSchema,
        host: z.string().optional(),
        port: PortSchema.optional(),
        database: z.string().min(1, 'Database name is required'),
        filename: z.string().optional(),
        user: z.string().optional(),
        password: z.string().optional(),
        ssl: SSLSchema.optional(),
        pool: PoolSchema.optional(),
    })
    .refine((conn) => conn.dialect === 'sqlite' || conn.host, {
        message: 'Host is required for non-SQLite databases',
        path: ['host'],
    });

/**
 * Paths configuration schema.
 */
const PathsSchema = z.object({
    schema: z.string().min(1, 'Schema path is required'),
    changesets: z.string().min(1, 'Changesets path is required'),
});

/**
 * Full config schema.
 */
export const ConfigSchema = z.object({
    name: ConfigNameSchema,
    type: z.enum(['local', 'remote']).default('local'),
    isTest: z.boolean().default(false),
    protected: z.boolean().default(false),
    connection: ConnectionSchema,
    paths: PathsSchema,
    identity: z.string().optional(),
});

/**
 * Partial connection schema (all fields optional).
 */
const PartialConnectionSchema = z.object({
    dialect: DialectSchema.optional(),
    host: z.string().optional(),
    port: PortSchema.optional(),
    database: z.string().optional(),
    filename: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: SSLSchema.optional(),
    pool: PoolSchema.optional(),
});

/**
 * Partial paths schema.
 */
const PartialPathsSchema = z.object({
    schema: z.string().optional(),
    changesets: z.string().optional(),
});

/**
 * Partial config schema for updates.
 *
 * All fields are optional for partial updates.
 */
export const ConfigInputSchema = z.object({
    name: z
        .string()
        .regex(/^[a-z0-9_-]+$/i)
        .optional(),
    type: z.enum(['local', 'remote']).optional(),
    isTest: z.boolean().optional(),
    protected: z.boolean().optional(),
    connection: PartialConnectionSchema.optional(),
    paths: PartialPathsSchema.optional(),
    identity: z.string().optional(),
});

/**
 * Schema for env-only config (CI mode).
 *
 * Allows missing name (will be generated as '__env__').
 */
export const EnvConfigSchema = ConfigSchema.extend({
    name: ConfigNameSchema.optional(),
});

// ─────────────────────────────────────────────────────────────
// Type Exports
// ─────────────────────────────────────────────────────────────

export type ConfigSchemaType = z.infer<typeof ConfigSchema>;
export type ConfigInputSchemaType = z.infer<typeof ConfigInputSchema>;
export type ConnectionSchemaType = z.infer<typeof ConnectionSchema>;

// ─────────────────────────────────────────────────────────────
// Validation Functions
// ─────────────────────────────────────────────────────────────

/**
 * Error thrown when config validation fails.
 *
 * Includes the specific field that failed and all validation issues.
 */
export class ConfigValidationError extends Error {

    constructor(
        message: string,
        public readonly field: string,
        public readonly issues: z.ZodIssue[],
    ) {

        super(message);
        this.name = 'ConfigValidationError';

    }

}

/**
 * Validate a complete config object.
 *
 * @throws ConfigValidationError if validation fails
 *
 * @example
 * ```typescript
 * const [_, err] = attemptSync(() => validateConfig(config))
 * if (err) {
 *     console.error(`Invalid config: ${err.message}`)
 * }
 * ```
 */
export function validateConfig(config: unknown): asserts config is ConfigSchemaType {

    const result = ConfigSchema.safeParse(config);

    if (!result.success) {

        const firstIssue = result.error.issues[0];

        throw new ConfigValidationError(
            firstIssue?.message ?? 'Validation failed',
            firstIssue?.path.join('.') || 'unknown',
            result.error.issues,
        );

    }

}

/**
 * Validate a partial config for updates.
 *
 * @throws ConfigValidationError if validation fails
 *
 * @example
 * ```typescript
 * // Valid partial - only updating host
 * validateConfigInput({ connection: { host: 'new-host.local' } })
 *
 * // Invalid partial - bad port
 * validateConfigInput({ connection: { port: 99999 } })
 * ```
 */
export function validateConfigInput(input: unknown): asserts input is ConfigInputSchemaType {

    const result = ConfigInputSchema.safeParse(input);

    if (!result.success) {

        const firstIssue = result.error.issues[0];

        throw new ConfigValidationError(
            firstIssue?.message ?? 'Validation failed',
            firstIssue?.path.join('.') || 'unknown',
            result.error.issues,
        );

    }

}

/**
 * Parse and validate config, returning defaults for missing fields.
 *
 * Unlike validateConfig which only validates, this returns the
 * parsed config with defaults applied.
 *
 * @example
 * ```typescript
 * const minimal = {
 *     name: 'dev',
 *     connection: { dialect: 'sqlite', database: ':memory:' },
 *     paths: { schema: './schema', changesets: './changesets' },
 * }
 *
 * const config = parseConfig(minimal)
 * // config.type === 'local' (default)
 * // config.isTest === false (default)
 * // config.protected === false (default)
 * ```
 */
export function parseConfig(config: unknown): ConfigSchemaType {

    const result = ConfigSchema.safeParse(config);

    if (!result.success) {

        const firstIssue = result.error.issues[0];

        throw new ConfigValidationError(
            firstIssue?.message ?? 'Validation failed',
            firstIssue?.path.join('.') || 'unknown',
            result.error.issues,
        );

    }

    return result.data;

}
