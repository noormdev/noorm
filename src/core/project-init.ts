/**
 * Project initialization — shared between TUI `InitScreen` and CLI `noorm init`.
 *
 * Creates the on-disk structure for a new noorm project:
 * - `sql/` and `changes/` directories with .gitkeep
 * - `.noorm/`, `.noorm/state/`, `.noorm/.gitignore`
 * - `settings.yml` via SettingsManager
 * - `state.enc` via StateManager
 * - Appends `# noorm` block to project `.gitignore` if missing
 *
 * Identity is created/updated only when `identityInfo` is supplied.
 * When `identityInfo` is null, callers must ensure a global identity already
 * exists (keys + metadata in `~/.noorm/`).
 */
import {
    existsSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    appendFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import {
    createCryptoIdentity,
    createIdentityForExistingKeys,
    hasKeyFiles,
    loadIdentityMetadata,
} from './identity/index.js';
import { SettingsManager } from './settings/manager.js';
import { StateManager, getStateManager } from './state/index.js';
import { observer } from './observer.js';

/**
 * What the project `.gitignore` block must exclude: `state.enc` holds every
 * config and secret, and `noorm.log` sits beside it.
 */
const NOORM_IGNORE_ENTRY = '.noorm/state/';

const NOORM_GITIGNORE_BLOCK = `\n# noorm\n${NOORM_IGNORE_ENTRY}\n`;

export interface ProjectInitIdentityInfo {
    name: string;
    email: string;
    machine?: string;
}

export interface ProjectInitOptions {
    projectRoot: string;
    force: boolean;
    identityInfo: ProjectInitIdentityInfo | null;
}

export interface ProjectInitResult {
    success: boolean;
    createdIdentity: boolean;
    createdFiles: string[];
}

/**
 * Bootstraps a noorm project: directories, settings, state, and (optionally) identity.
 * When `identityInfo` is null, a global identity must already exist.
 */
export async function performProjectInit(
    opts: ProjectInitOptions,
): Promise<ProjectInitResult> {

    const { projectRoot, force, identityInfo } = opts;

    const sqlPath = join(projectRoot, 'sql');
    const changesPath = join(projectRoot, 'changes');
    const noormPath = join(projectRoot, '.noorm');
    const statePath = join(noormPath, 'state');
    const gitignorePath = join(projectRoot, '.gitignore');

    const created: string[] = [];

    mkdirSync(sqlPath, { recursive: true });
    writeFileSync(join(sqlPath, '.gitkeep'), '', { flag: 'a' });
    created.push('sql/.gitkeep');

    mkdirSync(changesPath, { recursive: true });
    writeFileSync(join(changesPath, '.gitkeep'), '', { flag: 'a' });
    created.push('changes/.gitkeep');

    mkdirSync(noormPath, { recursive: true });
    mkdirSync(statePath, { recursive: true });

    const noormGitignorePath = join(noormPath, '.gitignore');
    if (!existsSync(noormGitignorePath)) {

        writeFileSync(noormGitignorePath, 'state/\n');
        created.push('.noorm/.gitignore');

    }

    const keysExist = await hasKeyFiles();
    const existingMetadata = await loadIdentityMetadata();

    let privateKey: string | undefined;
    let createdIdentity = false;

    if (identityInfo) {

        if (!keysExist) {

            const [result, err] = await attempt(() =>
                createCryptoIdentity({
                    name: identityInfo.name,
                    email: identityInfo.email,
                    machine: identityInfo.machine,
                }),
            );
            if (err) throw err;
            privateKey = result!.keypair.privateKey;
            createdIdentity = true;
            created.push('~/.noorm/identity.key', '~/.noorm/identity.pub');

        }
        else if (!existingMetadata) {

            await createIdentityForExistingKeys({
                name: identityInfo.name,
                email: identityInfo.email,
                machine: identityInfo.machine,
            });
            createdIdentity = true;

        }

    }

    const settingsManager = new SettingsManager(projectRoot);
    await settingsManager.init(force);
    created.push('.noorm/settings.yml');

    const stateManager = new StateManager(projectRoot, { privateKey });
    await stateManager.load();
    created.push('.noorm/state/state.enc');

    const singleton = getStateManager(projectRoot);
    await singleton.reloadPrivateKey();

    if (existsSync(gitignorePath)) {

        const existing = readFileSync(gitignorePath, 'utf-8');

        // Keyed on the entry rather than the `# noorm` header: earlier
        // versions wrote the header with nothing under it, and those
        // projects would otherwise skip the append forever.
        if (!existing.includes(NOORM_IGNORE_ENTRY)) {

            appendFileSync(gitignorePath, NOORM_GITIGNORE_BLOCK);

        }

    }
    else {

        writeFileSync(gitignorePath, NOORM_GITIGNORE_BLOCK.trimStart());

    }

    observer.emit('init:complete', { projectRoot, hasIdentity: createdIdentity });

    return {
        success: true,
        createdIdentity,
        createdFiles: created,
    };

}
