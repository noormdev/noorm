/**
 * Environment Detection
 *
 * Utilities for detecting the runtime environment (CI, headless, etc.).
 * Used by logger and other modules that need to adapt behavior based on context.
 */

/**
 * CI environment variable names to check.
 */
const CI_ENV_VARS = [
    'CI',
    'CONTINUOUS_INTEGRATION',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'TRAVIS',
    'JENKINS_URL',
    'BUILDKITE',
    'TEAMCITY_VERSION',
    'TF_BUILD',
    'BITBUCKET_BUILD_NUMBER',
];

/**
 * Detect if running in a CI/headless environment.
 *
 * Checks for:
 * - NOORM_HEADLESS=true environment variable
 * - Common CI environment variables
 * - No TTY available
 *
 * @example
 * ```typescript
 * if (isCi()) {
 *     // Log to stdout instead of file
 *     console.log('Running in CI mode')
 * }
 * ```
 */
export function isCi(): boolean {

    // Explicit headless flag
    if (process.env['NOORM_HEADLESS'] === 'true') {

        return true;

    }

    // Check CI environment variables
    for (const envVar of CI_ENV_VARS) {

        if (process.env[envVar]) {

            return true;

        }

    }

    // No TTY available (piped output, non-interactive)
    if (!process.stdout.isTTY) {

        return true;

    }

    return false;

}

/**
 * Check if running in development mode.
 *
 * @returns true if NODE_ENV is 'development' or NOORM_DEV is set
 */
export function isDev(): boolean {

    return process.env['NODE_ENV'] === 'development' || process.env['NOORM_DEV'] === 'true';

}

/**
 * Check if debug logging is enabled.
 *
 * @returns true if NOORM_DEBUG is set
 */
export function isDebug(): boolean {

    return process.env['NOORM_DEBUG'] === 'true';

}
