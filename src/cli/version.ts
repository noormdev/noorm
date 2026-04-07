/**
 * noorm version — show version and diagnostic information.
 *
 * Displays CLI version, identity paths, and project status.
 * Useful for debugging installation and configuration issues.
 */
import { existsSync } from 'fs';

import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import {
    getNoormHomePath,
    getPrivateKeyPath,
    getPublicKeyPath,
    hasKeyFiles,
    loadIdentityMetadata,
} from '../core/identity/storage.js';
import { findProjectRoot } from '../core/project.js';
import { getStateManager } from '../core/state/index.js';
import { getCurrentVersion } from '../core/update/checker.js';
import { outputResult, sharedArgs } from './_utils.js';

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
        stateError: string | null;
    };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Gather all diagnostic version info.
 *
 * Collects identity paths, project detection results, and config counts
 * without requiring a live database connection.
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
    const [identityMeta] = await attempt(() => loadIdentityMetadata());

    const privateKeyExists = existsSync(privateKeyPath);
    const publicKeyExists = existsSync(publicKeyPath);

    const projectResult = findProjectRoot();

    let configCount = 0;
    let activeConfig: string | null = null;
    let stateError: string | null = null;

    if (projectResult.hasProject && projectResult.projectRoot) {

        const [manager, loadErr] = await attempt(async () => {

            const mgr = getStateManager(projectResult.projectRoot!);
            await mgr.load();

            return mgr;

        });

        if (loadErr) {

            stateError = loadErr.message;

        }
        else if (manager) {

            const configs = manager.listConfigs();
            configCount = configs.length;
            const active = manager.getActiveConfig();
            activeConfig = active?.name ?? null;

        }

    }

    // === Commit block ===
    return {
        version: getCurrentVersion(),
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
            stateError,
        },
    };

}

/**
 * Format version info for human-readable output.
 */
function formatVersionOutput(info: VersionInfo): string {

    const lines: string[] = [];

    lines.push(`noorm ${info.version}`);
    lines.push(`Node ${info.node} (${info.platform}-${info.arch})`);
    lines.push('');

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
    lines.push('Project:');

    if (info.project.found) {

        lines.push(`  path:         ${info.project.path}`);

        if (info.project.stateError) {

            lines.push(`  state error:  ${info.project.stateError}`);

        }
        else {

            lines.push(`  configs:      ${info.project.configCount}`);

            if (info.project.activeConfig) {

                lines.push(`  active:       ${info.project.activeConfig}`);

            }
            else if (info.project.configCount > 0) {

                lines.push('  active:       none selected');

            }

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

const versionCommand = defineCommand({
    meta: {
        name: 'version',
        description: 'Show version and diagnostic information',
    },
    args: {
        json: sharedArgs.json,
    },
    async run({ args }) {

        const info = await gatherVersionInfo();

        if (args.json) {

            outputResult(args, info, '');

        }
        else {

            process.stdout.write(formatVersionOutput(info) + '\n');

        }

        process.exit(0);

    },
});

(versionCommand as typeof versionCommand & { examples: string[] }).examples = [
    'noorm version',
    'noorm version --json',
];

export default versionCommand;
