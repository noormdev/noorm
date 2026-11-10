/**
 * Shared lock status loading hook.
 *
 * Extracts the identical ~75-line useEffect pattern from all 4
 * lock screens: resolve identity, connect, fetch status.
 * Delegates to useConnection for shared connection management.
 *
 * @example
 * ```typescript
 * const { status, identityStr, loading, error } = useLockStatus(
 *     activeConfig, activeConfigName, cryptoIdentity,
 * );
 * ```
 */
import { useState, useEffect, useCallback } from 'react';

import type { LockStatus } from '../../core/lock/index.js';
import type { CryptoIdentity } from '../../core/identity/types.js';
import type { Config } from '../../core/index.js';

import { attempt } from '@logosdx/utils';
import { getLockManager } from '../../core/lock/index.js';
import { checkConfigPolicy } from '../../core/policy/index.js';
import { formatIdentity } from '../../core/identity/index.js';
import { resolveScreenIdentity } from '../utils/index.js';
import { useConnection } from './useConnection.js';

/**
 * Result from useLockStatus hook.
 */
export interface LockStatusResult {
    status: LockStatus | null;
    identityStr: string;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

/**
 * Load lock status for the active config.
 *
 * Resolves identity, uses shared connection, and fetches lock status
 * via getLockManager(). Provides a reload callback for refresh.
 * Pass `enabled: false` when policy refuses the screen: connecting bootstraps the tracking tables, which is a write.
 *
 * @example
 * ```typescript
 * const { status, identityStr, loading, error } = useLockStatus(
 *     activeConfig, activeConfigName, cryptoIdentity,
 * );
 * ```
 */
export function useLockStatus(
    activeConfig: Config | null,
    activeConfigName: string | null,
    cryptoIdentity: CryptoIdentity | null | undefined,
    enabled = true,
): LockStatusResult {

    const [status, setStatus] = useState<LockStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [identityStr, setIdentityStr] = useState<string>('');
    const [reloadCounter, setReloadCounter] = useState(0);

    const reload = useCallback(() => {

        setReloadCounter((c) => c + 1);

    }, []);

    // Shared connection with schema ensured (lock tables need __noorm_* schema)
    const { db, dialect, loading: connLoading, error: connError } = useConnection({ ensureSchema: true, enabled });

    useEffect(() => {

        if (!activeConfig || !activeConfigName) {

            setLoading(false);

            return;

        }

        // Resolve identity immediately
        const identity = resolveScreenIdentity(cryptoIdentity);
        const formattedIdentity = formatIdentity(identity);
        setIdentityStr(formattedIdentity);

        if (connError) {

            setError(connError);
            setLoading(false);

            return;

        }

        if (!db || connLoading) {

            return;

        }

        let cancelled = false;

        const loadStatus = async () => {

            setLoading(true);
            setError(null);

            const lockManager = getLockManager();

            const removeExpired = checkConfigPolicy('user', activeConfig, 'lock:acquire').allowed;
            const [result, err] = await attempt(() => lockManager.status(db, activeConfigName, dialect ?? 'postgres', { removeExpired }));

            if (!cancelled && err) {

                setError(err instanceof Error ? err.message : String(err));

            }

            if (!cancelled && result) {

                setStatus(result);

            }

            if (!cancelled) {

                setLoading(false);

            }

        };

        loadStatus();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, cryptoIdentity, db, dialect, connLoading, connError, reloadCounter]);

    return { status, identityStr, loading, error, reload };

}
