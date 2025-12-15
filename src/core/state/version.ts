/**
 * Package version accessor.
 *
 * Provides the current package version for state versioning.
 * Uses createRequire since ESM JSON imports are experimental.
 */
import { createRequire } from 'module'


const require = createRequire(import.meta.url)


/**
 * Get the current package version.
 *
 * WHY: State files are versioned by the package version that last wrote them.
 * This enables migrations when upgrading noorm across versions.
 */
export function getPackageVersion(): string {

    const pkg = require('../../../package.json') as { version: string }
    return pkg.version
}
