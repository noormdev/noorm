/**
 * noorm settings secret — interactive secret REQUIREMENT declaration.
 *
 * Manages which secrets are REQUIRED for stages, NOT the secret values.
 * Loop: pick action (add/edit/remove/list/done), pick scope (universal
 * or a stage), collect details, apply, repeat. Cancelling inside any
 * sub-prompt returns to the action loop; only the top-level "Done" or
 * a cancel there ends the session.
 */
import * as p from '@clack/prompts';
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { getSettingsManager } from '../../core/settings/index.js';
import type { SecretType, Stage, StageSecret } from '../../core/settings/types.js';
import { isYesMode, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

type Manager = ReturnType<typeof getSettingsManager>;

type Action = 'add' | 'edit' | 'remove' | 'list' | 'done';

type Scope = 'universal' | string;

interface SecretRow {
    scope: Scope;
    key: string;
    secret: StageSecret;
}

/**
 * Prompt for a complete secret definition. Returns null if the user
 * cancels at any step (caller should return to its loop).
 */
async function promptSecretDefinition(
    defaults?: Partial<StageSecret>,
): Promise<StageSecret | null> {

    const key = await p.text({
        message: 'Secret key name',
        initialValue: defaults?.key ?? '',
        placeholder: 'e.g. DB_PASSWORD',
        validate: (v: string | undefined) => (v?.trim() ? undefined : 'Key is required'),
    });

    if (p.isCancel(key)) return null;

    const type = await p.select<SecretType>({
        message: 'Secret type',
        initialValue: defaults?.type ?? 'string',
        options: [
            { value: 'string', label: 'String', hint: 'Plain text' },
            { value: 'password', label: 'Password', hint: 'Masked input' },
            { value: 'api_key', label: 'API Key', hint: 'Masked, validated format' },
            { value: 'connection_string', label: 'Connection String', hint: 'Validated as URI' },
        ],
    });

    if (p.isCancel(type)) return null;

    const description = await p.text({
        message: 'Description (optional)',
        initialValue: defaults?.description ?? '',
        placeholder: 'Shown in CLI prompts',
    });

    if (p.isCancel(description)) return null;

    const required = await p.confirm({
        message: 'Required?',
        initialValue: defaults?.required !== false,
    });

    if (p.isCancel(required)) return null;

    return {
        key: key.trim(),
        type,
        description: description.trim() || undefined,
        required,
    };

}

/**
 * Pick scope: universal or a specific stage. Returns null on cancel.
 */
async function promptScope(stages: Record<string, Stage>): Promise<Scope | null> {

    const stageNames = Object.keys(stages);

    const scope = await p.select<Scope>({
        message: 'Secret scope',
        options: [
            { value: 'universal', label: 'Universal', hint: 'Applies to all stages' },
            ...stageNames.map((name) => ({ value: name, label: `Stage: ${name}` })),
        ],
    });

    if (p.isCancel(scope)) return null;

    return scope;

}

/**
 * Collect every defined secret as a flat list for picker display.
 */
function collectSecrets(manager: Manager): SecretRow[] {

    const rows: SecretRow[] = [];

    for (const s of manager.getUniversalSecrets()) {

        rows.push({ scope: 'universal', key: s.key, secret: s });

    }

    for (const [name, stage] of Object.entries(manager.getStages())) {

        for (const s of stage.secrets ?? []) {

            rows.push({ scope: name, key: s.key, secret: s });

        }

    }

    return rows;

}

/**
 * Render the current secret table for the user.
 */
function listSecrets(manager: Manager): string[] {

    const rows = collectSecrets(manager);

    if (rows.length === 0) return ['No secret requirements defined.'];

    const lines: string[] = [];
    let lastScope: string | null = null;

    for (const r of rows) {

        if (r.scope !== lastScope) {

            lines.push(r.scope === 'universal' ? 'Universal:' : `Stage "${r.scope}":`);
            lastScope = r.scope;

        }

        const optional = r.secret.required === false ? ' [optional]' : '';
        lines.push(`  ${r.secret.key} (${r.secret.type})${optional}`);

    }

    return lines;

}

/**
 * Add action.
 */
async function handleAdd(manager: Manager): Promise<void> {

    const scope = await promptScope(manager.getStages());

    if (scope === null) return;

    const secret = await promptSecretDefinition();

    if (secret === null) return;

    const [, err] = await attempt(() =>
        scope === 'universal'
            ? manager.addUniversalSecret(secret)
            : manager.addStageSecret(scope, secret),
    );

    if (err) {

        p.log.error(err.message);

        return;

    }

    p.log.success(`Secret requirement "${secret.key}" added.`);

}

/**
 * Edit action.
 */
async function handleEdit(manager: Manager): Promise<void> {

    const rows = collectSecrets(manager);

    if (rows.length === 0) {

        p.log.warn('No secrets to edit.');

        return;

    }

    const picked = await p.select<SecretRow>({
        message: 'Which secret to edit?',
        options: rows.map((r) => ({
            value: r,
            label: `[${r.scope}] ${r.key} (${r.secret.type})`,
        })),
    });

    if (p.isCancel(picked)) return;

    const updated = await promptSecretDefinition(picked.secret);

    if (updated === null) return;

    const [, err] = await attempt(() =>
        picked.scope === 'universal'
            ? manager.updateUniversalSecret(picked.key, updated)
            : manager.updateStageSecret(picked.scope, picked.key, updated),
    );

    if (err) {

        p.log.error(err.message);

        return;

    }

    p.log.success(`Secret requirement "${picked.key}" updated.`);

}

/**
 * Remove action.
 */
async function handleRemove(manager: Manager): Promise<void> {

    const rows = collectSecrets(manager);

    if (rows.length === 0) {

        p.log.warn('No secrets to remove.');

        return;

    }

    const picked = await p.select<SecretRow>({
        message: 'Which secret to remove?',
        options: rows.map((r) => ({
            value: r,
            label: `[${r.scope}] ${r.key} (${r.secret.type})`,
        })),
    });

    if (p.isCancel(picked)) return;

    const scopeLabel = picked.scope === 'universal'
        ? 'universal'
        : `stage "${picked.scope}"`;

    const confirm = await p.confirm({
        message: `Remove "${picked.key}" from ${scopeLabel}?`,
    });

    if (p.isCancel(confirm) || !confirm) {

        p.log.info('Skipped.');

        return;

    }

    const [, err] = await attempt(() =>
        picked.scope === 'universal'
            ? manager.removeUniversalSecret(picked.key)
            : manager.removeStageSecret(picked.scope, picked.key),
    );

    if (err) {

        p.log.error(err.message);

        return;

    }

    p.log.success(`Secret requirement "${picked.key}" removed.`);

}

const secretCommand = defineCommand({
    meta: { name: 'secret', description: 'Manage secret requirements in settings' },
    args: {
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        // This command manages secret REQUIREMENT declarations in
        // settings.yml — not the values. There's no clean non-interactive
        // analog, so redirect users to direct YAML edits + the existing
        // 'noorm secret set' command for actual values.
        if (isYesMode(args)) {

            process.stderr.write(
                'Error: noorm settings secret is interactive only.\n' +
                "Edit the 'secrets' section of settings.yml directly to add/remove requirements.\n" +
                'To set actual secret values, use: noorm secret set <key> <value>\n',
            );
            process.exit(EXIT.USAGE);

        }

        if (!process.stdin.isTTY) {

            process.stderr.write('Error: noorm settings secret requires an interactive terminal.\n');
            process.exit(EXIT.USAGE);

        }

        const projectRoot = process.cwd();
        const settingsManager = getSettingsManager(projectRoot);

        const fileExists = await settingsManager.exists();

        if (!fileExists) {

            process.stderr.write('Error: No settings.yml found. Run: noorm settings init\n');
            process.exit(EXIT.USAGE);

        }

        const [, loadErr] = await attempt(() => settingsManager.load());

        if (loadErr) {

            process.stderr.write(`Error: Failed to load settings: ${loadErr.message}\n`);
            process.exit(1);

        }

        p.intro('noorm settings secret');
        p.log.info(listSecrets(settingsManager).join('\n'));

        while (true) {

            const action = await p.select<Action>({
                message: 'Action',
                options: [
                    { value: 'add', label: 'Add requirement' },
                    { value: 'edit', label: 'Edit requirement' },
                    { value: 'remove', label: 'Remove requirement' },
                    { value: 'list', label: 'List current' },
                    { value: 'done', label: 'Done' },
                ],
            });

            if (p.isCancel(action) || action === 'done') break;

            if (action === 'add') await handleAdd(settingsManager);
            else if (action === 'edit') await handleEdit(settingsManager);
            else if (action === 'remove') await handleRemove(settingsManager);
            else if (action === 'list') p.log.info(listSecrets(settingsManager).join('\n'));

        }

        p.outro('Secret requirements saved.');
        process.exit(0);

    },
});

(secretCommand as typeof secretCommand & { examples: string[] }).examples = [
    'noorm settings secret',
];

export default secretCommand;
