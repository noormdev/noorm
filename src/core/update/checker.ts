/**
 * Version comparison and update detection logic.
 *
 * Handles:
 * - Stable version updates (1.0.0 -> 1.1.0)
 * - Pre-release channel updates (1.0.0-alpha.1 -> 1.0.0-alpha.2)
 * - Cross-channel behavior (alpha stays on alpha until stable release)
 *
 * @example
 * ```typescript
 * const result = await checkForUpdate();
 * if (result?.updateAvailable) {
 *     console.log(`Update available: ${result.latestVersion}`);
 * }
 * ```
 */
import { observer } from '../observer.js';
import { fetchPackageInfo, getLatestForChannel, getVersionsOnChannel } from './registry.js';
import type { UpdateCheckResult } from './types.js';

// =============================================================================
// Version Access
// =============================================================================

/**
 * Build-time injected CLI version.
 *
 * Defined in tsup.cli.config.ts via esbuild's define option.
 */
declare const __CLI_VERSION__: string;

/**
 * Get the current CLI version.
 *
 * Returns '0.0.0-dev' in development when __CLI_VERSION__ is not defined.
 */
export function getCurrentVersion(): string {

    return typeof __CLI_VERSION__ !== 'undefined'
        ? __CLI_VERSION__
        : '0.0.0-dev';

}

// =============================================================================
// Version Parsing
// =============================================================================

/**
 * Pre-release version info.
 */
export interface PrereleaseInfo {
    /** Channel name (alpha, beta, rc) */
    channel: string;

    /** Pre-release number (e.g., 5 from alpha.5) */
    number: number;
}

/**
 * Parse pre-release info from version string.
 *
 * @param version - Semver version string
 * @returns Pre-release info or null if stable
 *
 * @example
 * ```typescript
 * parsePrerelease('1.0.0-alpha.5');  // { channel: 'alpha', number: 5 }
 * parsePrerelease('1.0.0');          // null
 * parsePrerelease('2.0.0-beta.1');   // { channel: 'beta', number: 1 }
 * ```
 */
export function parsePrerelease(version: string): PrereleaseInfo | null {

    const match = version.match(/-(\w+)\.?(\d+)?$/);

    if (!match || !match[1]) {

        return null;

    }

    return {
        channel: match[1],
        number: match[2] ? parseInt(match[2], 10) : 0,
    };

}

// =============================================================================
// Version Comparison
// =============================================================================

/**
 * Check if update is a major version bump.
 *
 * Major version changes may include breaking changes.
 *
 * @param current - Current version string
 * @param latest - Latest version string
 * @returns True if major version increased
 *
 * @example
 * ```typescript
 * isMajorVersionUpdate('1.5.2', '2.0.0');  // true
 * isMajorVersionUpdate('1.5.2', '1.6.0');  // false
 * isMajorVersionUpdate('1.5.2', '1.5.3');  // false
 * ```
 */
export function isMajorVersionUpdate(current: string, latest: string): boolean {

    const currentBase = current.split('-')[0] ?? '0.0.0';
    const latestBase = latest.split('-')[0] ?? '0.0.0';

    const currentMajor = parseInt(currentBase.split('.')[0] ?? '0', 10);
    const latestMajor = parseInt(latestBase.split('.')[0] ?? '0', 10);

    return latestMajor > currentMajor;

}

/**
 * Compare two semver versions.
 *
 * Handles pre-release versions according to semver spec:
 * - Stable is always greater than pre-release of same base
 * - Pre-releases compared by channel then number
 *
 * @param a - First version
 * @param b - Second version
 * @returns -1 if a < b, 0 if equal, 1 if a > b
 *
 * @example
 * ```typescript
 * compareVersions('1.0.0', '2.0.0');          // -1
 * compareVersions('1.0.0', '1.0.0');          // 0
 * compareVersions('2.0.0', '1.0.0');          // 1
 * compareVersions('1.0.0', '1.0.0-alpha.1');  // 1 (stable > prerelease)
 * ```
 */
export function compareVersions(a: string, b: string): number {

    // Strip prerelease suffix for base comparison
    const baseA = a.split('-')[0] ?? '0.0.0';
    const baseB = b.split('-')[0] ?? '0.0.0';

    const partsA = baseA.split('.').map(Number);
    const partsB = baseB.split('.').map(Number);

    // Compare major.minor.patch
    for (let i = 0; i < 3; i++) {

        const partA = partsA[i] ?? 0;
        const partB = partsB[i] ?? 0;

        if (partA > partB) {

            return 1;

        }

        if (partA < partB) {

            return -1;

        }

    }

    // Same base version, check prerelease
    const preA = parsePrerelease(a);
    const preB = parsePrerelease(b);

    // No prerelease = stable = higher than prerelease
    if (!preA && preB) {

        return 1;

    }

    if (preA && !preB) {

        return -1;

    }

    if (!preA && !preB) {

        return 0;

    }

    // Both prerelease - compare channel then number
    // Channel order: alpha < beta < rc
    const channelOrder: Record<string, number> = { alpha: 0, beta: 1, rc: 2 };
    const orderA = channelOrder[preA!.channel] ?? 99;
    const orderB = channelOrder[preB!.channel] ?? 99;

    if (orderA !== orderB) {

        return orderA > orderB ? 1 : -1;

    }

    // Same channel, compare number
    const numDiff = preA!.number - preB!.number;

    if (numDiff === 0) {

        return 0;

    }

    return numDiff > 0 ? 1 : -1;

}

// =============================================================================
// Update Check
// =============================================================================

/**
 * Check for available updates.
 *
 * Logic:
 * - If current is stable, check against 'latest' tag
 * - If current is alpha/beta/rc, check against that channel's latest
 * - Pre-release can upgrade to stable if stable is newer
 * - Development version (0.0.0-dev) never triggers updates
 *
 * @returns Update check result or null if offline/error
 *
 * @example
 * ```typescript
 * const result = await checkForUpdate();
 * if (result?.updateAvailable) {
 *     if (result.isMajorUpdate) {
 *         // Show confirmation dialog
 *     }
 *     else {
 *         // Auto-update if enabled
 *     }
 * }
 * ```
 */
export async function checkForUpdate(): Promise<UpdateCheckResult | null> {

    const currentVersion = getCurrentVersion();

    // Dev version never triggers updates
    if (currentVersion === '0.0.0-dev') {

        return {
            currentVersion,
            latestVersion: currentVersion,
            updateAvailable: false,
            isMajorUpdate: false,
            isPrerelease: true,
            channel: 'dev',
        };

    }

    observer.emit('update:checking', {});

    const packageInfo = await fetchPackageInfo();

    if (!packageInfo) {

        // Offline or error - skip gracefully
        observer.emit('update:check-failed', { error: 'Network error or timeout' });

        return null;

    }

    const currentPrerelease = parsePrerelease(currentVersion);
    let latestVersion: string;

    if (currentPrerelease) {

        // Current is pre-release - check that channel
        const channelVersions = getVersionsOnChannel(packageInfo, currentPrerelease.channel);
        const latestOnChannel = channelVersions[channelVersions.length - 1];

        // Also check stable - if stable is newer than our base, use that
        const stableLatest = getLatestForChannel(packageInfo, 'latest');

        if (stableLatest && compareVersions(stableLatest, currentVersion) > 0) {

            latestVersion = stableLatest;

        }
        else {

            latestVersion = latestOnChannel ?? currentVersion;

        }

    }
    else {

        // Current is stable - check 'latest' tag
        latestVersion = getLatestForChannel(packageInfo, 'latest') ?? currentVersion;

    }

    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    const isMajorUpdate = updateAvailable && isMajorVersionUpdate(currentVersion, latestVersion);

    const result: UpdateCheckResult = {
        currentVersion,
        latestVersion,
        updateAvailable,
        isMajorUpdate,
        isPrerelease: !!currentPrerelease,
        channel: currentPrerelease?.channel,
    };

    if (updateAvailable) {

        if (isMajorUpdate) {

            observer.emit('update:major-available', {
                currentVersion,
                latestVersion,
            });

        }
        else {

            observer.emit('update:available', {
                currentVersion,
                latestVersion,
            });

        }

    }
    else {

        observer.emit('update:not-available', { currentVersion });

    }

    return result;

}
