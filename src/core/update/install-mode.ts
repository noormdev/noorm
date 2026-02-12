/**
 * Installation mode detection.
 *
 * Determines how noorm was installed to route updates correctly:
 * - npm: installed via npm/bun global install → update via package manager
 * - binary: standalone compiled binary → update via GitHub release download
 * - development: running from source → no updates
 */
import { getCurrentVersion } from './checker.js';

/**
 * How noorm was installed on this machine.
 */
export type InstallMode = 'npm' | 'binary' | 'development';

/**
 * Detect how noorm was installed.
 *
 * Detection logic:
 * - Development: version is '0.0.0-dev' (running from source)
 * - Binary: Bun runtime present and not inside a node_modules tree
 * - npm: everything else (installed via npm/yarn/bun global)
 *
 * @example
 * ```typescript
 * const mode = detectInstallMode();
 *
 * if (mode === 'binary') {
 *     // Download replacement binary from GitHub releases
 * }
 * else if (mode === 'npm') {
 *     // Run npm install -g
 * }
 * ```
 */
export function detectInstallMode(): InstallMode {

    const version = getCurrentVersion();

    if (version === '0.0.0-dev') {

        return 'development';

    }

    const isBun = typeof (globalThis as Record<string, unknown>)['Bun'] !== 'undefined';
    const inNodeModules = typeof __filename !== 'undefined' && __filename.includes('node_modules');

    if (isBun && !inNodeModules) {

        return 'binary';

    }

    return 'npm';

}

/**
 * GitHub repository for binary releases.
 */
const GITHUB_REPO = 'noormdev/noorm';

/**
 * Get the download URL for a binary release.
 *
 * @param version - Semver version to download
 * @returns URL to the platform-appropriate binary asset
 *
 * @example
 * ```typescript
 * const url = getBinaryDownloadUrl('1.2.0');
 * // → 'https://github.com/noormdev/noorm/releases/download/@noormdev/cli@1.2.0/noorm-darwin-arm64'
 * ```
 */
export function getBinaryDownloadUrl(version: string): string {

    const platform = process.platform;
    const arch = process.arch;

    let suffix: string;

    if (platform === 'darwin' && arch === 'arm64') {

        suffix = 'darwin-arm64';

    }
    else if (platform === 'darwin' && arch === 'x64') {

        suffix = 'darwin-x64';

    }
    else if (platform === 'linux' && arch === 'arm64') {

        suffix = 'linux-arm64';

    }
    else if (platform === 'linux' && arch === 'x64') {

        suffix = 'linux-x64';

    }
    else if (platform === 'win32') {

        suffix = 'windows-x64.exe';

    }
    else {

        suffix = `${platform}-${arch}`;

    }

    return `https://github.com/${GITHUB_REPO}/releases/download/%40noormdev%2Fcli%40${version}/noorm-${suffix}`;

}
