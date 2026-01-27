/**
 * Vault event types.
 *
 * All events emitted by the vault module. These are merged into
 * NoormEvents via the VaultEvents interface.
 */

/**
 * Vault events for observer integration.
 *
 * Events follow the naming convention `vault:{operation}`.
 */
export interface VaultEvents {
    /** Vault was initialized for the first time */
    'vault:initialized': {
        identityHash: string;
    };

    /** New vault secret was created */
    'vault:secret:created': {
        key: string;
        setBy: string;
    };

    /** Existing vault secret was updated */
    'vault:secret:updated': {
        key: string;
        setBy: string;
    };

    /** Vault secret was deleted */
    'vault:secret:deleted': {
        key: string;
    };

    /** Vault key was propagated to a user */
    'vault:propagated': {
        toIdentityHash: string;
        toEmail: string;
    };

    /** Vault copy operation started */
    'vault:copy:starting': {
        source: string;
        destination: string;
        keys: 'all' | number;
    };

    /** Vault copy operation completed */
    'vault:copy:completed': {
        source: string;
        destination: string;
        copied: number;
        skipped: number;
        errors: number;
    };
}

