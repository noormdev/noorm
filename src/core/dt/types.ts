/**
 * Core type definitions for the .dt data transfer format.
 *
 * Defines the universal type system that bridges database-specific types
 * across PostgreSQL, MySQL, and MSSQL. Provides schema, column, and
 * encoding types used by all other dt module components.
 *
 * @example
 * ```typescript
 * import type { DtSchema, DtColumn, UniversalType } from './types.js';
 *
 * const schema: DtSchema = {
 *     v: 1,
 *     d: 'postgresql',
 *     dv: '16.2',
 *     t: 'users',
 *     columns: [
 *         { name: 'id', type: 'int' },
 *         { name: 'email', type: 'string' },
 *     ],
 * };
 * ```
 */
import type { Dialect } from '../connection/types.js';

// ---------------------------------------------------------------------------
// Universal type system
// ---------------------------------------------------------------------------

/**
 * Simple types stored as native JSON values. No encoding tuple needed.
 */
export type SimpleType =
    | 'string'
    | 'int'
    | 'bigint'
    | 'float'
    | 'decimal'
    | 'bool'
    | 'timestamp'
    | 'date'
    | 'uuid';

/**
 * Encoded types that always use a `[value, encoding]` tuple in .dt files.
 */
export type EncodedType =
    | 'json'
    | 'binary'
    | 'vector'
    | 'array'
    | 'text'
    | 'custom';

/**
 * All universal types recognized by the .dt format.
 */
export type UniversalType = SimpleType | EncodedType;

/**
 * Encoding method for encoded type values.
 *
 * - `raw` - Native JSON value, no transformation
 * - `b64` - Base64-encoded bytes (small binary data)
 * - `gz64` - Gzip-compressed then Base64-encoded (large payloads)
 */
export type Encoding = 'raw' | 'b64' | 'gz64';

/**
 * Encoded value tuple as stored in .dt row data.
 *
 * First element is the value, second is the encoding method.
 * Additional config elements may follow for future extension.
 */
export type EncodedValue = [unknown, Encoding, ...unknown[]];

/**
 * Any value that can appear in a .dt row.
 *
 * Simple types produce native JSON values; encoded types produce tuples.
 */
export type DtValue = unknown | EncodedValue | null;

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

/**
 * Format version. Only version 1 is currently defined.
 */
export type FormatVersion = 1;

/**
 * Column definition within a .dt schema.
 *
 * @example
 * ```typescript
 * const col: DtColumn = {
 *     name: 'embedding',
 *     type: 'vector',
 *     sourceType: 'vector(1536)',
 *     nullable: false,
 * };
 * ```
 */
export interface DtColumn {

    /** Column name as it appears in the source database. */
    name: string;

    /** Universal type classification. */
    type: UniversalType;

    /** Original database-specific type (e.g., `jsonb`, `vector(1536)`). */
    sourceType?: string;

    /** Whether NULL values are permitted. Default: true. */
    nullable?: boolean;

}

/**
 * .dt file schema header (line 1 of every .dt file).
 *
 * Contains format metadata and column definitions. Written as JSON5.
 *
 * @example
 * ```typescript
 * const schema: DtSchema = {
 *     v: 1,
 *     d: 'postgresql',
 *     dv: '16.2',
 *     t: 'users',
 *     columns: [
 *         { name: 'id', type: 'int' },
 *         { name: 'metadata', type: 'json', sourceType: 'jsonb' },
 *     ],
 * };
 * ```
 */
export interface DtSchema {

    /** Format version. Current: 1. */
    v: FormatVersion;

    /** Source database dialect (`postgresql`, `mysql`, `mssql`). */
    d: string;

    /** Source database version (e.g., `"16.2"`, `"2025"`, `"9.0"`). */
    dv: string;

    /** Source table name. Optional for multi-table exports. */
    t?: string;

    /** Column definitions. */
    columns: DtColumn[];

}

// ---------------------------------------------------------------------------
// Database version
// ---------------------------------------------------------------------------

/**
 * Parsed database version for version-aware type mapping.
 *
 * @example
 * ```typescript
 * const version: DatabaseVersion = {
 *     dialect: 'mssql',
 *     major: 2025,
 *     minor: 0,
 *     raw: '16.0.4175.1',
 * };
 * ```
 */
export interface DatabaseVersion {

    /** Database dialect. */
    dialect: Dialect;

    /** Major version number. */
    major: number;

    /** Minor version number. */
    minor: number;

    /** Raw version string from the database. */
    raw: string;

}

// ---------------------------------------------------------------------------
// Type mapping result
// ---------------------------------------------------------------------------

/**
 * Result of mapping a database type to a universal type.
 */
export interface TypeMappingResult {

    /** The universal type this maps to. */
    universalType: UniversalType;

    /** Whether the source type is natively supported (vs. workaround). */
    native: boolean;

}

// ---------------------------------------------------------------------------
// Options interfaces
// ---------------------------------------------------------------------------

/**
 * Options for DtWriter.
 */
export interface DtWriterOptions {

    /** Output file path. Extension determines format (.dt, .dtz, .dtzx). */
    filepath: string;

    /** Schema header to write on line 1. */
    schema: DtSchema;

    /** Rows per flush batch. Default: 1000. */
    batchSize?: number;

    /** Passphrase for .dtzx encryption. Required for .dtzx files. */
    passphrase?: string;

}

/**
 * Options for DtReader.
 */
export interface DtReaderOptions {

    /** Input file path. Extension determines format (.dt, .dtz, .dtzx). */
    filepath: string;

    /** Passphrase for .dtzx decryption. Required for .dtzx files. */
    passphrase?: string;

}

/**
 * Options for DtStreamer (in-memory cross-dialect transfer).
 */
export interface DtStreamerOptions {

    /** Source database dialect. */
    sourceDialect: Dialect;

    /** Source database version for version-aware mapping. */
    sourceVersion?: DatabaseVersion;

    /** Target database dialect. */
    targetDialect: Dialect;

    /** Target database version for version-aware mapping. */
    targetVersion?: DatabaseVersion;

    /** Column definitions for the table being transferred. */
    columns: DtColumn[];

    /** Soft row count limit per batch. Default: 100. */
    batchSize?: number;

    /** Soft memory limit per batch in bytes. Default: 1GB. */
    maxBatchBytes?: number;

}

/**
 * Options for building a DtSchema from a live database.
 */
export interface BuildSchemaOptions {

    /** Kysely database instance. */
    db: unknown;

    /** Database dialect. */
    dialect: Dialect;

    /** Table name to inspect. */
    tableName: string;

    /** Database version for version-aware mapping. */
    version?: DatabaseVersion;

    /** Schema/namespace (e.g., 'public' for PostgreSQL). */
    schema?: string;

}

/**
 * Options for schema validation against a target database.
 */
export interface ValidateSchemaOptions {

    /** The .dt schema to validate. */
    dtSchema: DtSchema;

    /** Target Kysely database instance. */
    targetDb: unknown;

    /** Target database dialect. */
    targetDialect: Dialect;

    /** Target database version. */
    targetVersion?: DatabaseVersion;

}

/**
 * Schema validation result.
 */
export interface SchemaValidationResult {

    /** Whether the schema is compatible with the target. */
    valid: boolean;

    /** Blocking errors that prevent transfer. */
    errors: string[];

    /** Non-blocking warnings about potential issues. */
    warnings: string[];

}

/**
 * Options for exporting a table to a .dt file.
 */
export interface ExportTableOptions {

    /** Kysely database instance. */
    db: unknown;

    /** Database dialect. */
    dialect: Dialect;

    /** Table name to export. */
    tableName: string;

    /** Output file path (.dt, .dtz, or .dtzx). */
    filepath: string;

    /** Database version. */
    version?: DatabaseVersion;

    /** Schema/namespace. */
    schema?: string;

    /** Passphrase for .dtzx encryption. */
    passphrase?: string;

    /** Rows per batch. Default: 1000. */
    batchSize?: number;

}

/**
 * Options for importing a .dt file into a database.
 */
export interface ImportFileOptions {

    /** Input file path (.dt, .dtz, or .dtzx). */
    filepath: string;

    /** Target Kysely database instance. */
    db: unknown;

    /** Target database dialect. */
    dialect: Dialect;

    /** Target database version. */
    version?: DatabaseVersion;

    /** Passphrase for .dtzx decryption. */
    passphrase?: string;

    /** Conflict strategy. Default: 'fail'. */
    onConflict?: 'fail' | 'skip' | 'update' | 'replace';

    /** Filter to specific tables (for multi-table files). */
    tables?: string[];

    /** Truncate target table before import. */
    truncate?: boolean;

    /** Rows per batch. Default: 1000. */
    batchSize?: number;

}

/**
 * Passphrase-encrypted payload structure.
 */
export interface DtEncryptedPayload {

    /** Random salt for PBKDF2 key derivation (base64). */
    salt: string;

    /** Initialization vector (base64). */
    iv: string;

    /** GCM authentication tag (base64). */
    authTag: string;

    /** Encrypted ciphertext (base64). */
    ciphertext: string;

}
