/**
 * Package version accessor.
 *
 * Provides the current package version for state versioning.
 * Version is injected at build time via esbuild define.
 */

// Declare the build-time injected constant
declare const __CLI_VERSION__: string;

// Fallback for development (when not bundled)
const VERSION = typeof __CLI_VERSION__ !== 'undefined'
    ? __CLI_VERSION__
    : '0.0.0-dev';

/**
 * Get the current package version.
 *
 * WHY: State files are versioned by the package version that last wrote them.
 * This enables migrations when upgrading noorm across versions.
 */
export function getPackageVersion(): string {

    return VERSION;

}
