/**
 * Config validate algorithm.
 *
 * Single source for the three-check sequence (connection, name/database
 * presence, host presence for non-sqlite) shared by `cli/config/validate.ts`
 * (text/JSON output) and `ConfigValidateScreen.tsx` (`StatusList`/toast).
 * Both call `validateConfigChecks` and keep only their own presentation
 * layer.
 */
import { testConnection } from '../connection/factory.js';
import type { Config } from './types.js';

/**
 * Result of a single validate check.
 */
export interface ConfigCheckResult {
    key: string;
    label: string;
    status: 'success' | 'error';
    detail: string;
}

/**
 * Runs the config-validate check sequence against a resolved config:
 * connection test, then name/database presence, then host presence for
 * non-sqlite dialects. All checks always run (no fail-fast) so callers can
 * show a full report; `valid` is the AND of every check's status.
 *
 * @example
 * ```typescript
 * const { checks, valid } = await validateConfigChecks(config);
 * ```
 */
export async function validateConfigChecks(
    config: Config,
): Promise<{ checks: ConfigCheckResult[]; valid: boolean }> {

    const checks: ConfigCheckResult[] = [];
    let valid = true;

    const connResult = await testConnection(config.connection);

    checks.push({
        key: 'connection',
        label: 'Connection',
        status: connResult.ok ? 'success' : 'error',
        detail: connResult.ok ? 'Connection successful' : (connResult.error ?? 'Connection failed'),
    });

    if (!connResult.ok) valid = false;

    const requiredChecks = [
        { key: 'name', label: 'Name', value: config.name },
        { key: 'database', label: 'Database', value: config.connection.database },
    ];

    for (const check of requiredChecks) {

        const isSet = Boolean(check.value);
        checks.push({
            key: check.key,
            label: check.label,
            status: isSet ? 'success' : 'error',
            detail: isSet ? check.value : 'Not set',
        });

        if (!isSet) valid = false;

    }

    if (config.connection.dialect !== 'sqlite') {

        const host = config.connection.host;
        const hasHost = Boolean(host);

        checks.push({
            key: 'host',
            label: 'Host',
            status: hasHost ? 'success' : 'error',
            detail: host ? host : 'Not set',
        });

        if (!hasHost) valid = false;

    }

    return { checks, valid };

}
