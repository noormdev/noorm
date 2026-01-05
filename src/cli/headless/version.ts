/**
 * Version command for diagnostic output.
 *
 * Displays CLI version, identity paths, and project status.
 * Useful for debugging installation and configuration issues.
 *
 * @example
 * ```bash
 * noorm version
 * noorm -H --json version
 * ```
 */
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { attempt } from '@logosdx/utils';

import type { HeadlessCommand, RouteHandler } from './_helpers.js';
import {
    getNoormHomePath,
    getPrivateKeyPath,
    getPublicKeyPath,
    hasKeyFiles,
    loadIdentityMetadata,
} from '../../core/identity/storage.js';
import { findProjectRoot, getGlobalNoormPath } from '../../core/project.js';
import { getStateManager } from '../../core/state/index.js';

// =============================================================================
// Constants
// =============================================================================

// CLI version - updated during release process
const CLI_VERSION = '1.0.0-alpha.4';

// =============================================================================
// Types
// =============================================================================

interface VersionInfo {
    version: string;
    node: string;
    platform: string;
    arch: string;
    identity: {
        exists: boolean;
        homePath: string;
        privateKeyPath: string;
        publicKeyPath: string;
        privateKeyExists: boolean;
        publicKeyExists: boolean;
        name?: string;
        email?: string;
        identityHash?: string;
        envVarSet: boolean;
    };
    project: {
        found: boolean;
        path: string | null;
        cwd: string;
        configCount: number;
        activeConfig: string | null;
    };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Gather all diagnostic version info.
 */
async function gatherVersionInfo(): Promise<VersionInfo> {

    // === Declaration block ===
    const noormHome = getNoormHomePath();
    const privateKeyPath = getPrivateKeyPath();
    const publicKeyPath = getPublicKeyPath();

    // === Validation block ===
    const hasKeys = await hasKeyFiles();
    const envVarSet = !!process.env['NOORM_IDENTITY'];

    // === Business logic block ===
    // Load identity metadata if available
    const [identityMeta] = await attempt(() => loadIdentityMetadata());

    // Check if key files exist individually
    const privateKeyExists = existsSync(privateKeyPath);
    const publicKeyExists = existsSync(publicKeyPath);

    // Find project without changing directory
    const projectResult = findProjectRoot();

    // Try to load state for config info
    let configCount = 0;
    let activeConfig: string | null = null;

    if (projectResult.hasProject && projectResult.projectRoot) {

        const [manager] = await attempt(async () => {

            const mgr = getStateManager(projectResult.projectRoot!);
            await mgr.load();

            return mgr;

        });

        if (manager) {

            const configs = manager.listConfigs();
            configCount = configs.length;
            const active = manager.getActiveConfig();
            activeConfig = active?.name ?? null;

        }

    }

    // === Commit block ===
    return {
        version: CLI_VERSION,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        identity: {
            exists: hasKeys || envVarSet,
            homePath: noormHome,
            privateKeyPath,
            publicKeyPath,
            privateKeyExists,
            publicKeyExists,
            name: identityMeta?.name,
            email: identityMeta?.email,
            identityHash: identityMeta?.identityHash,
            envVarSet,
        },
        project: {
            found: projectResult.hasProject,
            path: projectResult.projectRoot,
            cwd: process.cwd(),
            configCount,
            activeConfig,
        },
    };

}

/**
 * Format version info for human-readable output.
 */
function formatVersionOutput(info: VersionInfo): string {

    const lines: string[] = [];

    // Version header
    lines.push(`noorm ${info.version}`);
    lines.push(`Node ${info.node} (${info.platform}-${info.arch})`);
    lines.push('');

    // Identity section
    lines.push('Identity:');

    if (info.identity.envVarSet) {

        lines.push('  source:       NOORM_IDENTITY env var');

    }
    else if (info.identity.exists) {

        lines.push(`  home:         ${info.identity.homePath}`);
        lines.push(`  private key:  ${info.identity.privateKeyPath} ${info.identity.privateKeyExists ? '✓' : '✗ missing'}`);
        lines.push(`  public key:   ${info.identity.publicKeyPath} ${info.identity.publicKeyExists ? '✓' : '✗ missing'}`);

        if (info.identity.name) {

            lines.push(`  name:         ${info.identity.name}`);

        }

        if (info.identity.email) {

            lines.push(`  email:        ${info.identity.email}`);

        }

        if (info.identity.identityHash) {

            lines.push(`  hash:         ${info.identity.identityHash.substring(0, 16)}...`);

        }

    }
    else {

        lines.push('  status:       Not configured (run: noorm init)');
        lines.push(`  expected at:  ${info.identity.homePath}`);

    }

    lines.push('');

    // Project section
    lines.push('Project:');

    if (info.project.found) {

        lines.push(`  path:         ${info.project.path}`);
        lines.push(`  configs:      ${info.project.configCount}`);

        if (info.project.activeConfig) {

            lines.push(`  active:       ${info.project.activeConfig}`);

        }
        else if (info.project.configCount > 0) {

            lines.push('  active:       none selected');

        }

    }
    else {

        lines.push('  status:       No project found');
        lines.push(`  cwd:          ${info.project.cwd}`);

    }

    return lines.join('\n');

}

// =============================================================================
// Command
// =============================================================================

export const help = `
# VERSION

Show noorm version and diagnostic information.

## Usage

    noorm version
    noorm -H --json version

## Description

Displays:
- CLI version and Node.js environment
- Identity configuration paths and status
- Project detection and configuration count

Useful for debugging installation issues.

## JSON Output

{
    "version": "1.0.0-alpha.3",
    "node": "v22.14.0",
    "platform": "darwin",
    "arch": "arm64",
    "identity": {
        "exists": true,
        "homePath": "~/.noorm",
        "privateKeyPath": "~/.noorm/identity.key",
        "publicKeyPath": "~/.noorm/identity.pub",
        "name": "Your Name",
        "email": "you@example.com"
    },
    "project": {
        "found": true,
        "path": "/path/to/project",
        "configCount": 2,
        "activeConfig": "dev"
    }
}
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const info = await gatherVersionInfo();

    if (flags.json) {

        process.stdout.write(JSON.stringify(info, null, 2) + '\n');

    }
    else {

        process.stdout.write(formatVersionOutput(info) + '\n');

    }

    return 0;

};

const handler: RouteHandler = {
    run,
    help,
};

export default handler;
