/**
 * Project initialization — shared between TUI `InitScreen` and CLI `noorm init`.
 *
 * Creates the on-disk structure for a new noorm project:
 * - `db/sql/` and `db/changes/` directories with .gitkeep
 * - `db/AGENTS.md` and `db/CLAUDE.md` agent steering, when absent
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
import { join, posix } from 'node:path';

import { attempt } from '@logosdx/utils';

import {
    createCryptoIdentity,
    createIdentityForExistingKeys,
    hasKeyFiles,
    loadIdentityMetadata,
} from './identity/index.js';
import { SettingsManager } from './settings/manager.js';
import {
    DEFAULT_PATH_CONFIG,
    INIT_CHANGES_PATH,
    INIT_DB_DIR,
    INIT_PATH_CONFIG,
    INIT_SQL_PATH,
    isInitLayout,
} from './settings/defaults.js';
import type { PathConfig } from './settings/types.js';
import { StateManager, getStateManager } from './state/index.js';
import { observer } from './observer.js';

/**
 * What the project `.gitignore` block must exclude: `state.enc` holds every
 * config and secret, and `noorm.log` sits beside it.
 */
const NOORM_IGNORE_ENTRY = '.noorm/state/';

const NOORM_GITIGNORE_BLOCK = `\n# noorm\n${NOORM_IGNORE_ENTRY}\n`;

const AGENTS_TEMPLATE = 'Use the `/noorm` skill for managing files here.\n\n<!-- add user specific LLM steering here -->\n';

// Claude Code skips AGENTS.md when a CLAUDE.md is present, so CLAUDE.md imports it.
const CLAUDE_TEMPLATE = '@AGENTS.md\n';

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
 * Paths a project's settings.yml carries after init. A project that already has
 * a settings.yml keeps what it resolves to, so `--force` never repoints it at
 * a layout it does not have; only a new project gets the `db/` layout.
 *
 * @example
 * const paths = await resolveInitPaths('/project'); // INIT_PATH_CONFIG when new
 */
export async function resolveInitPaths(projectRoot: string): Promise<PathConfig> {

    const manager = new SettingsManager(projectRoot);

    if (!(await manager.exists())) return INIT_PATH_CONFIG;

    const [settings] = await attempt(() => manager.load());

    return settings?.paths ?? DEFAULT_PATH_CONFIG;

}

/**
 * Creates `db/sql/`, `db/changes/`, and the agent steering files beside them,
 * for projects on the init layout. The steering files hold the user's edits,
 * so they are written only when absent.
 *
 * @example
 * scaffoldDbLayout('/project', INIT_PATH_CONFIG); // ['db/sql/.gitkeep', ..., 'db/CLAUDE.md']
 */
export function scaffoldDbLayout(projectRoot: string, paths: PathConfig): string[] {

    if (!isInitLayout(paths)) return [];

    const created: string[] = [];
    const agentFiles = {
        'AGENTS.md': AGENTS_TEMPLATE,
        'CLAUDE.md': CLAUDE_TEMPLATE,
    };

    for (const dir of [INIT_SQL_PATH, INIT_CHANGES_PATH]) {

        const relativeDir = posix.normalize(dir);

        mkdirSync(join(projectRoot, relativeDir), { recursive: true });
        writeFileSync(join(projectRoot, relativeDir, '.gitkeep'), '', { flag: 'a' });
        created.push(`${relativeDir}/.gitkeep`);

    }

    for (const [name, body] of Object.entries(agentFiles)) {

        const filePath = join(projectRoot, INIT_DB_DIR, name);

        if (existsSync(filePath)) continue;

        writeFileSync(filePath, body);
        created.push(`${INIT_DB_DIR}/${name}`);

    }

    return created;

}

/**
 * Bootstraps a noorm project: directories, settings, state, and (optionally) identity.
 * When `identityInfo` is null, a global identity must already exist.
 */
export async function performProjectInit(
    opts: ProjectInitOptions,
): Promise<ProjectInitResult> {

    const { projectRoot, force, identityInfo } = opts;

    const noormPath = join(projectRoot, '.noorm');
    const statePath = join(noormPath, 'state');
    const gitignorePath = join(projectRoot, '.gitignore');

    const created: string[] = [];
    const paths = await resolveInitPaths(projectRoot);

    created.push(...scaffoldDbLayout(projectRoot, paths));

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
    await settingsManager.setPaths(paths);
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
