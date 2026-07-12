/**
 * Configuration Zod schemas and validation.
 *
 * Uses Zod for declarative validation with better error messages
 * and type inference.
 */
import { z } from 'zod';

import { resolveLegacyAccess } from '../policy/index.js';
import type { ConfigAccess } from '../policy/index.js';

/**
 * Valid database dialects.
 */
export const DialectSchema = z.enum(['postgres', 'mysql', 'sqlite', 'mssql']);

/**
 * Per-channel access roles. Mirrors `ConfigAccess` from `core/policy`.
 */
const RoleSchema = z.enum(['viewer', 'operator', 'admin']);

const AccessSchema = z.object({
    user: RoleSchema,
    mcp: z.union([RoleSchema, z.literal(false)]),
});

/**
 * Resolves the final `access` from raw input that may carry either the new
 * `access` field, the legacy `protected` boolean, or neither.
 *
 * `access` wins when present. Otherwise the legacy boolean maps to a role
 * pair for one version (`docs/spec/config-access-roles.md#migration`).
 * `access` is the only stored source of truth — the legacy boolean is never
 * echoed back in the output.
 */
function withResolvedAccess<T extends { protected?: boolean; access?: ConfigAccess }>(
    data: T,
): Omit<T, 'protected' | 'access'> & { access: ConfigAccess } {

    const { protected: legacyProtected, access, ...rest } = data;

    return {
        ...rest,
        access: resolveLegacyAccess(access, legacyProtected),
    };

}

/**
 * Config name pattern - alphanumeric with hyphens and underscores.
 */
export const ConfigNameSchema = z
    .string()
    .min(1, 'Config name is required')
    .regex(
        /^[a-z0-9_-]+$/i,
        'Config name must contain only letters, numbers, hyphens, and underscores',
    );

/**
 * Port number validation.
 */
export const PortSchema = z
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
 * Full config object schema, before access/protected resolution.
 */
const ConfigObjectSchema = z.object({
    name: ConfigNameSchema,
    type: z.enum(['local', 'remote']).default('local'),
    isTest: z.boolean().default(false),
    /** Legacy input path — mapped to `access` by `withResolvedAccess`. */
    protected: z.boolean().optional(),
    access: AccessSchema.optional(),
    connection: ConnectionSchema,
    identity: z.string().optional(),
});

/**
 * Full config schema. Resolves `access` (defaulting/mapping legacy
 * `protected`) and derives `protected` from it.
 */
export const ConfigSchema = ConfigObjectSchema.transform(withResolvedAccess);

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
    access: AccessSchema.optional(),
    /** Legacy input path — mapped to `access` by `ConfigSchema`. */
    protected: z.boolean().optional(),
    connection: PartialConnectionSchema.optional(),
    identity: z.string().optional(),
});

/**
 * Schema for env-only config (CI mode).
 *
 * Allows missing name (will be generated as '__env__').
 */
export const EnvConfigSchema = ConfigObjectSchema
    .extend({ name: ConfigNameSchema.optional() })
    .transform(withResolvedAccess);

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
 * }
 *
 * const config = parseConfig(minimal)
 * // config.type === 'local' (default)
 * // config.isTest === false (default)
 * // config.access === { user: 'admin', mcp: 'admin' } (default)
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
