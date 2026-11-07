import * as p from '@clack/prompts';
import { defineCommand } from 'citty';
import { parseConfig } from '../../core/config/schema.js';
import { restrictAccess, stageFields } from '../../core/config/stage.js';
import { PROTECTED_STAGE_CEILING } from '../../core/config/resolver.js';
import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { initState } from '../../core/state/index.js';
import { outputError, outputResult, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

export default defineCommand({
    meta: { name: 'sync', description: 'Preview and reapply stage defaults to a stored config' },
    args: {
        stage: { type: 'string', required: true, description: 'Source stage' },
        name: { type: 'string', description: 'Target config (defaults to stage name)' },
        yes: sharedArgs.yes, json: sharedArgs.json,
    },
    async run({ args }) {

        try {

            const root = process.cwd();
            const settings = getSettingsManager(root);
            await settings.load();
            const stage = settings.getStage(args.stage);
            if (!stage) throw new Error(`Stage '${args.stage}' not found`);
            const state = await initState(root);
            const name = args.name ?? args.stage;
            const existing = state.getConfig(name);
            if (!existing) throw new Error(`Config '${name}' not found`);
            const policy = checkConfigPolicy(resolveChannel(), existing, 'config:write');
            if (!policy.allowed) throw new Error(policy.blockedReason ?? `Cannot modify '${name}'`);
            const defaults = stage.defaults ?? {};
            if (defaults.dialect && defaults.dialect !== existing.connection.dialect) throw new Error('Stage dialect differs from existing config');
            const fields = stageFields(defaults);
            let access = fields.access ? restrictAccess(existing.access, fields.access) : existing.access;
            if (defaults.protected) access = restrictAccess(access, PROTECTED_STAGE_CEILING);
            const updated = parseConfig({ ...existing, ...fields, access, connection: { ...existing.connection, ...fields.connection } });
            const changes: { field: string; before: unknown; after: unknown }[] = [];
            for (const key of ['type', 'isTest', 'access'] as const) {

                if (JSON.stringify(existing[key]) !== JSON.stringify(updated[key])) {

                    changes.push({ field: key, before: existing[key], after: updated[key] });

                }

            }
            for (const key of Object.keys(fields.connection ?? {}) as (keyof typeof existing.connection)[]) {

                if (JSON.stringify(existing.connection[key]) !== JSON.stringify(updated.connection[key])) {

                    changes.push({ field: `connection.${key}`, before: existing.connection[key], after: updated.connection[key] });

                }

            }
            const text = `Stage '${args.stage}' → config '${name}'\n` + (changes.length ? changes.map((change) => `${change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join('\n') : 'No changes');
            if (!args.json) console.log(text);
            let confirmed = changes.length > 0 && args.yes === true;
            if (changes.length && !confirmed && process.stdin.isTTY && !args.json) {

                const answer = await p.confirm({ message: 'Apply these changes?', initialValue: false });
                confirmed = !p.isCancel(answer) && answer === true;

            }
            if (confirmed) await state.setConfig(name, updated);
            if (args.json) outputResult(args, { stage: args.stage, name, changes, applied: confirmed }, text);
            else if (confirmed) console.log(`Updated config '${name}'.`);

        }
        catch (error) {

            outputError(args, error instanceof Error ? error.message : 'Failed to sync config');
            process.exit(EXIT.USAGE);

        }

    },
});
