import * as p from '@clack/prompts';
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';
import { parseConfig } from '../../core/config/schema.js';
import { SettingsProvider, validateAccessRoles, withConfigPolicy } from '../../core/config/resolver.js';
import { combineSsl } from '../../core/config/ssl-combine.js';
import { stageFields } from '../../core/config/stage.js';
import { SSL_FIELD_PAIRS } from '../../core/connection/types.js';
import { checkConfigPolicy, compareCells, getConfigPermission, MATRIX, resolveChannel } from '../../core/policy/index.js';
import type { Channel, Permission } from '../../core/policy/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { initState } from '../../core/state/index.js';
import { outputError, outputResult, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const INLINE_PEM_FIELDS: readonly string[] = SSL_FIELD_PAIRS.map(([inline]) => inline);

/** The preview prints behind `config:write`, which is not `secret:read`, so a stored PEM never reaches it. */
function redactInlinePem(value: unknown): unknown {

    if (typeof value !== 'object' || value === null) return value;

    return Object.fromEntries(
        Object.entries(value).map(([key, field]) =>
            [key, INLINE_PEM_FIELDS.includes(key) && field !== undefined ? '[inline PEM]' : field]),
    );

}

export default defineCommand({
    meta: { name: 'sync', description: 'Preview and reapply stage defaults to a stored config' },
    args: {
        stage: { type: 'string', required: true, description: 'Source stage' },
        name: { type: 'string', description: 'Target config (defaults to stage name)' },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [, error] = await attempt(async () => {

            const root = process.cwd();
            const settings = getSettingsManager(root);
            await settings.load();

            const stage = settings.getStage(args.stage);

            if (!stage) {

                throw new Error(`Stage '${args.stage}' not found`);

            }

            const state = await initState(root);
            const name = args.name ?? args.stage;
            const existing = state.getConfig(name);

            if (!existing) {

                throw new Error(`Config '${name}' not found`);

            }

            const provider = new SettingsProvider(settings);
            const boundExisting = withConfigPolicy(existing, provider);
            const policy = checkConfigPolicy(resolveChannel(), boundExisting, 'config:write');

            if (!policy.allowed) {

                throw new Error(policy.blockedReason ?? `Cannot modify '${name}'`);

            }

            const defaults = stage.defaults ?? {};

            if (defaults.dialect && defaults.dialect !== existing.connection.dialect) {

                throw new Error('Stage dialect differs from existing config');

            }

            if (defaults.protected && name !== args.stage) {

                throw new Error('A protected stage must use its stage name as the config name');

            }

            const fields = stageFields(defaults);
            const access = { ...existing.access };
            if (fields.access) {

                validateAccessRoles(fields.access, settings.settings.access?.roles);
                const candidate = withConfigPolicy({ ...existing, access: fields.access }, provider);
                const permissions = Object.keys(MATRIX) as Permission[];
                for (const channel of ['user', 'agent'] as Channel[]) {

                    const noLooser = permissions.every((permission) =>
                        compareCells(
                            getConfigPermission(channel, candidate, permission),
                            getConfigPermission(channel, boundExisting, permission),
                        ) <= 0);
                    if (!noLooser) continue;
                    if (channel === 'user') access.user = fields.access.user;
                    else if (existing.access.agent !== false || fields.access.agent === false) {

                        access.agent = fields.access.agent;

                    }

                }

            }

            const connection = { ...existing.connection, ...fields.connection };
            const ssl = combineSsl(existing.connection.ssl, fields.connection?.ssl);

            if (ssl !== undefined) connection.ssl = ssl;

            const updated = parseConfig({ ...existing, ...fields, access, connection });

            const changes: { field: string; before: unknown; after: unknown }[] = [];

            for (const key of ['type', 'isTest', 'access'] as const) {

                if (JSON.stringify(existing[key]) !== JSON.stringify(updated[key])) {

                    changes.push({ field: key, before: existing[key], after: updated[key] });

                }

            }

            for (const key of Object.keys(fields.connection ?? {}) as (keyof typeof existing.connection)[]) {

                if (JSON.stringify(existing.connection[key]) !== JSON.stringify(updated.connection[key])) {

                    changes.push({
                        field: `connection.${key}`,
                        before: redactInlinePem(existing.connection[key]),
                        after: redactInlinePem(updated.connection[key]),
                    });

                }

            }

            const changeText = changes.length
                ? changes.map((change) => `${change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join('\n')
                : 'No changes';
            const text = `Stage '${args.stage}' → config '${name}'\n${changeText}`;

            if (!args.json) {

                console.log(text);

            }

            let confirmed = changes.length > 0 && args.yes === true;

            if (changes.length && !confirmed && process.stdin.isTTY && !args.json) {

                const answer = await p.confirm({ message: 'Apply these changes?', initialValue: false });
                confirmed = !p.isCancel(answer) && answer === true;

            }

            if (confirmed) {

                await state.setConfig(name, updated);

            }

            if (args.json) {

                outputResult(args, { stage: args.stage, name, changes, applied: confirmed }, text);

            }
            else if (confirmed) {

                console.log(`Updated config '${name}'.`);

            }

        });

        if (error) {

            outputError(args, error.message);
            process.exit(EXIT.USAGE);

        }

    },
});
