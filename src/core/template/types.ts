/**
 * Template engine types.
 *
 * Defines the context object ($) available in templates, loader interfaces,
 * and configuration options for the template engine.
 */
import type { PipelineInputSnapshot } from '../pipeline/types.js';
import type { Dialect } from '../connection/types.js';

/**
 * Built-in helper functions available on the template context.
 */
export interface BuiltInHelpers {
    /**
     * Include another SQL file.
     * Path is resolved relative to the template's directory.
     *
     * @example
     * ```sql
     * {%~ await $.include('lib/uuid_function.sql') %}
     * ```
     */
    include: (path: string) => Promise<string>;

    /**
     * SQL-escape a string value.
     * Escapes single quotes by doubling them. Throws in pipeline renders; use `$.quote` there.
     *
     * @example
     * ```sql
     * WHERE name = '{%~ $.escape(userName) %}'
     * ```
     */
    escape: (value: string) => string;

    /**
     * SQL-escape and wrap in single quotes.
     * In pipelines the literal depends on the dialect: a MySQL hex literal, an MSSQL N'' literal,
     * and a PostgreSQL U&'' literal that fails instead of injecting when standard_conforming_strings is off.
     *
     * @example
     * ```sql
     * INSERT INTO users (name) VALUES ({%~ $.quote(userName) %});
     * ```
     */
    quote: (value: string | number | boolean | null) => string;

    /**
     * JSON stringify a value.
     *
     * @example
     * ```sql
     * INSERT INTO config (data) VALUES ({%~ $.quote($.json(configObject)) %});
     * ```
     */
    json: (value: unknown) => string;

    /**
     * Current ISO timestamp.
     *
     * @example
     * ```sql
     * INSERT INTO logs (created_at) VALUES ('{%~ $.now() %}');
     * ```
     */
    now: () => string;

    /**
     * Generate a UUID v4.
     *
     * @example
     * ```sql
     * INSERT INTO users (id) VALUES ('{%~ $.uuid() %}');
     * ```
     */
    uuid: () => string;
}

/**
 * Template context object ($) available in templates.
 *
 * Contains auto-loaded data, inherited helpers, secrets, and built-in functions.
 */
export interface TemplateContext extends BuiltInHelpers {
    /**
     * Active configuration object.
     * Only available if no `config.*` file exists in the template directory.
     */
    config?: object;

    /**
     * Decrypted secrets for the active config.
     */
    secrets: Record<string, string>;

    /**
     * Decrypted global secrets (shared across configs).
     */
    globalSecrets: Record<string, string>;

    /**
     * Environment variables.
     */
    env: Record<string, string | undefined>;

    /** Reserved invocation inputs when rendering a pipeline. */
    input?: PipelineInputSnapshot;

    /**
     * Auto-loaded data files and inherited helpers.
     * Keys are camelCased filenames (e.g., `$.users`, `$.seedData`).
     */
    [key: string]: unknown;
}

/**
 * Result from a data loader.
 */
export interface LoaderResult {
    /**
     * The parsed data.
     */
    data: unknown;

    /**
     * Original file path.
     */
    filepath: string;

    /**
     * File extension (e.g., '.json5', '.yml').
     */
    format: string;
}

/**
 * A data file loader function.
 */
export type Loader = (filepath: string) => Promise<unknown>;

/**
 * Registry of loaders by file extension.
 */
export type LoaderRegistry = Record<string, Loader>;

/**
 * Options for rendering a template.
 */
export interface RenderOptions {
    /**
     * Active configuration to include in context.
     */
    config?: object;

    /**
     * Secrets for the active config.
     */
    secrets?: Record<string, string>;

    /**
     * Global secrets shared across configs.
     */
    globalSecrets?: Record<string, string>;

    /**
     * Project root directory.
     * Used to determine where to stop walking up for helpers.
     * Defaults to process.cwd().
     */
    projectRoot?: string;

    /** Validated invocation inputs reserved for pipeline steps and includes. */
    pipelineInput?: PipelineInputSnapshot;

    /** Resolved target for pipeline SQL literals, including nested includes. */
    pipelineDialect?: Dialect;
}

/**
 * Result of processing a SQL file.
 */
export interface ProcessResult {
    /**
     * The SQL content (rendered if template, raw if .sql).
     */
    sql: string;

    /**
     * Whether the file was a template.
     */
    isTemplate: boolean;

    /**
     * Render duration in milliseconds (only for templates).
     */
    durationMs?: number;
}

/**
 * Supported data file extensions.
 */
export const DATA_EXTENSIONS = [
    '.json',
    '.json5',
    '.yaml',
    '.yml',
    '.csv',
    '.js',
    '.mjs',
    '.ts',
    '.sql',
] as const;

/**
 * Template file extension.
 */
export const TEMPLATE_EXTENSION = '.tmpl';

/**
 * Helper file name pattern.
 */
export const HELPER_FILENAME = '$helpers';

/**
 * Supported helper file extensions.
 */
export const HELPER_EXTENSIONS = ['.ts', '.js', '.mjs'] as const;
