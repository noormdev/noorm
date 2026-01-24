/**
 * NPM registry client for version checking.
 *
 * Fetches package metadata from registry.npmjs.org with:
 * - Timeout handling (5 second timeout)
 * - Graceful offline handling
 * - Pre-release tag support
 *
 * @example
 * ```typescript
 * const info = await fetchPackageInfo();
 * if (info) {
 *     const latest = getLatestForChannel(info, 'latest');
 *     console.log(`Latest version: ${latest}`);
 * }
 * ```
 */
import { attempt } from '@logosdx/utils';

// =============================================================================
// Constants
// =============================================================================

/** NPM registry URL for the CLI package */
const REGISTRY_URL = 'https://registry.npmjs.org/@noormdev/cli';

/** Timeout for registry requests in milliseconds */
const TIMEOUT_MS = 5000;

// =============================================================================
// Types
// =============================================================================

/**
 * Package metadata from npm registry.
 */
export interface RegistryPackageInfo {
    /** Distribution tags (e.g., { latest: '1.0.0', alpha: '1.1.0-alpha.1' }) */
    'dist-tags': Record<string, string>;

    /** All published versions */
    versions: Record<string, unknown>;

    /** Publish timestamps for each version */
    time: Record<string, string>;
}

// =============================================================================
// Registry Client
// =============================================================================

/**
 * Fetch package info from npm registry.
 *
 * Returns null on network error or timeout (graceful offline handling).
 *
 * @returns Package info or null if unavailable
 *
 * @example
 * ```typescript
 * const info = await fetchPackageInfo();
 * if (!info) {
 *     // Offline or error, skip update check
 *     return;
 * }
 * ```
 */
export async function fetchPackageInfo(): Promise<RegistryPackageInfo | null> {

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const [response, fetchErr] = await attempt(() =>
        fetch(REGISTRY_URL, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
        }),
    );

    clearTimeout(timeoutId);

    if (fetchErr) {

        // Network error or timeout - return null for graceful handling
        return null;

    }

    if (!response?.ok) {

        // HTTP error (404, 500, etc.) - return null
        return null;

    }

    const [data, jsonErr] = await attempt(() =>
        response.json() as Promise<RegistryPackageInfo>,
    );

    if (jsonErr) {

        // Invalid JSON - return null
        return null;

    }

    return data ?? null;

}

/**
 * Get latest version for a specific channel.
 *
 * @param packageInfo - Registry package info
 * @param channel - Release channel (latest, alpha, beta, rc)
 * @returns Version string or null if channel not found
 *
 * @example
 * ```typescript
 * const latest = getLatestForChannel(info, 'latest');
 * const alpha = getLatestForChannel(info, 'alpha');
 * ```
 */
export function getLatestForChannel(
    packageInfo: RegistryPackageInfo,
    channel: string = 'latest',
): string | null {

    return packageInfo['dist-tags'][channel] ?? null;

}

/**
 * Get all versions on a specific pre-release channel.
 *
 * Useful for finding the latest alpha when current is alpha.
 *
 * @param packageInfo - Registry package info
 * @param channel - Pre-release channel (alpha, beta, rc)
 * @returns Array of version strings on that channel, sorted ascending
 *
 * @example
 * ```typescript
 * const alphaVersions = getVersionsOnChannel(info, 'alpha');
 * // ['1.0.0-alpha.1', '1.0.0-alpha.2', '1.1.0-alpha.1']
 * ```
 */
export function getVersionsOnChannel(
    packageInfo: RegistryPackageInfo,
    channel: string,
): string[] {

    const versions = Object.keys(packageInfo.versions);

    const channelVersions = versions.filter((v) => v.includes(`-${channel}`));

    // Sort by semver (simple string sort works for same base version)
    channelVersions.sort((a, b) => {

        const [baseA = '0.0.0', preA] = a.split(`-${channel}`);
        const [baseB = '0.0.0', preB] = b.split(`-${channel}`);

        // Compare base versions first
        const baseCompare = baseA.localeCompare(baseB, undefined, { numeric: true });

        if (baseCompare !== 0) {

            return baseCompare;

        }

        // Compare pre-release numbers
        const numA = parseInt(preA?.replace('.', '') || '0', 10);
        const numB = parseInt(preB?.replace('.', '') || '0', 10);

        return numA - numB;

    });

    return channelVersions;

}
