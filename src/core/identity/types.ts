/**
 * Identity types.
 *
 * Identity determines "who" executed a changeset or SQL file,
 * used for audit trails in tracking tables.
 */


/**
 * Source of identity resolution.
 */
export type IdentitySource = 'config' | 'env' | 'git' | 'system'


/**
 * Resolved identity.
 *
 * @example
 * ```typescript
 * const identity: Identity = {
 *     name: 'John Doe',
 *     email: 'john@example.com',
 *     source: 'git',
 * }
 * ```
 */
export interface Identity {

    /** User's name */
    name: string

    /** User's email (optional) */
    email?: string

    /** How the identity was resolved */
    source: IdentitySource
}


/**
 * Options for identity resolution.
 */
export interface IdentityOptions {

    /** Override from config */
    configIdentity?: string

    /** Skip git lookup (faster, for CI) */
    skipGit?: boolean
}
