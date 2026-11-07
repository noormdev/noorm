import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Context } from '../sdk/context.js';
import { prepareRunContext } from '../sdk/namespaces/run.js';
import type { Permission } from '../core/policy/index.js';
import type { ChangeFile } from '../core/change/types.js';
import { filterFilesByPaths } from '../core/shared/index.js';
import { changeFilePlan, withApprovedContent } from '../core/shared/approved-content.js';
import type { ApprovedContent } from '../core/shared/approved-content.js';
import { getEffectiveBuildPaths } from '../core/settings/rules.js';
import { DEFAULT_SQL_PATH } from '../core/settings/defaults.js';
import { discoverFiles } from '../core/runner/index.js';
import { computeChecksumFromContent } from '../core/runner/checksum.js';
import { isTemplate, processFile } from '../core/template/index.js';

export interface PreparedCommand {
    summary: string;
    fingerprint: string;
    permissions?: readonly Permission[];
    run<T>(action: () => Promise<T>): Promise<T>;
}

/** Prepare only the effective SQL and plan. No database statements are executed. */
export async function prepareCommand(command: string, input: unknown, ctx: Context): Promise<PreparedCommand> {

    const args = z.record(z.string(), z.unknown()).parse(input);
    const fileCommand = ['run_file', 'run_build', 'change_run', 'change_ff', 'change_revert'].includes(command);
    if (!fileCommand) {

        const summary = JSON.stringify({ command, input }, null, 2);

        return { summary, fingerprint: hash(summary), run: (action) => action() };

    }

    const context = await ctx.noorm.run[prepareRunContext]();
    const secretValues = [...new Set([
        ...Object.values(context.secrets ?? {}),
        ...Object.values(context.globalSecrets ?? {}),
    ].filter((value) => value.length > 0))].sort((a, b) => b.length - a.length);
    // Match all values in one pass, so a value cannot match the redaction marker.
    const secretPattern = secretValues.length
        ? new RegExp(secretValues.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
        : null;
    const sql = new Map<string, string>();
    const checksums = new Map<string, string>();
    const changes = new Map<string, string>();
    const review: { change?: string; file: string; sql: string }[] = [];
    let buildFiles: string[] | undefined;
    let pending: string[] | undefined;

    const addSql = async (filepath: string, change?: string): Promise<void> => {

        let rendered = sql.get(filepath);
        if (rendered === undefined) {

            rendered = isTemplate(filepath)
                ? (await processFile(filepath, {
                    projectRoot: context.projectRoot,
                    config: context.config,
                    secrets: context.secrets,
                    globalSecrets: context.globalSecrets,
                })).sql
                : await readFile(filepath, 'utf-8');
            sql.set(filepath, rendered);
            checksums.set(filepath, computeChecksumFromContent(rendered));

        }
        review.push({
            ...(change ? { change } : {}),
            file: filepath,
            sql: secretPattern ? rendered.replace(secretPattern, () => '[REDACTED SECRET]') : rendered,
        });

    };

    const addChange = async (name: string, direction: 'change' | 'revert'): Promise<void> => {

        const change = await ctx.noorm.changes.parse(name);
        const files: ChangeFile[] = direction === 'change' ? change.changeFiles : change.revertFiles;
        changes.set(`${direction}:${change.name}`, changeFilePlan(files));
        for (const file of files) {

            if (file.type === 'txt') {

                const manifest = await readFile(file.path, 'utf-8');
                checksums.set(file.path, computeChecksumFromContent(manifest));
                if (!file.resolvedPaths) throw new Error(`Manifest was not resolved: ${file.path}`);
                for (const reference of file.resolvedPaths) await addSql(reference, name);

            }
            else await addSql(file.path, name);

        }

    };

    if (command === 'run_file') {

        const filepath = z.string().parse(args['path']);
        await addSql(path.isAbsolute(filepath) ? filepath : path.join(context.projectRoot, filepath));

    }
    else if (command === 'run_build') {

        const settings = ctx.noorm.settings;
        const config = ctx.noorm.config;
        const sqlPath = path.join(context.projectRoot, settings.paths?.sql ?? DEFAULT_SQL_PATH);
        const effective = getEffectiveBuildPaths(
            settings.build?.include ?? [], settings.build?.exclude ?? [], settings.rules ?? [],
            { name: config.name, access: config.access, isTest: config.isTest ?? false, type: config.type },
        );
        buildFiles = filterFilesByPaths(await discoverFiles(sqlPath), sqlPath, effective.include, effective.exclude);
        for (const filepath of buildFiles) await addSql(filepath);

    }
    else if (command === 'change_ff') {

        pending = (await ctx.noorm.changes.pending()).map((item) => item.name);
        for (const name of pending) await addChange(name, 'change');

    }
    else {

        await addChange(z.string().parse(args['name']), command === 'change_revert' ? 'revert' : 'change');

    }

    const scope: ApprovedContent = { sql, checksums, changes, buildFiles, pending };
    const summary = JSON.stringify({
        command, input, pending, changePlans: [...changes], files: review,
        ...(secretPattern ? { redactions: 'Known secret values in SQL are shown as [REDACTED SECRET].' } : {}),
    }, null, 2);

    return {
        summary,
        fingerprint: hash(JSON.stringify({ summary, changes: [...changes], buildFiles, pending, checksums: [...checksums] })),
        ...(command === 'change_ff' ? { permissions: ['change:run'] satisfies Permission[] } : {}),
        run: (action) => withApprovedContent(scope, action),
    };

}

function hash(value: string): string {

    return createHash('sha256').update(value).digest('hex');

}
