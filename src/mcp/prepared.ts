import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Context } from '../sdk/context.js';
import { prepareRunContext } from '../sdk/namespaces/run.js';
import type { ChangeFile } from '../core/change/types.js';
import { ChangeHistory, isPendingChange } from '../core/change/index.js';
import type { NoormDatabase } from '../core/shared/index.js';
import type { Kysely } from 'kysely';
import { filterFilesByPaths } from '../core/shared/index.js';
import { changeFilePlan, withApprovedContent } from '../core/shared/approved-content.js';
import type { ApprovedContent } from '../core/shared/approved-content.js';
import { getEffectiveBuildPaths } from '../core/settings/rules.js';
import { DEFAULT_SQL_PATH } from '../core/settings/defaults.js';
import { discoverFiles } from '../core/runner/index.js';
import { computeChecksumFromContent } from '../core/runner/checksum.js';
import { isTemplate } from '../core/template/index.js';

export interface PreparedCommand {
    summary: string;
    run<T>(action: () => Promise<T>): Promise<T>;
}

/** Password and SSL key/cert/ca values of a connection; user and database names are not secrets. */
export function connectionSecrets(connection: Context['noorm']['config']['connection']): (string | undefined)[] {

    const ssl = typeof connection.ssl === 'object' ? connection.ssl : undefined;

    return [connection.password, ssl?.key, ssl?.cert, ssl?.ca];

}

/** One-pass redactor, so a secret cannot match the redaction marker. Longest values match first. */
export function secretRedactor(values: readonly unknown[]): (text: string) => string {

    const secrets = [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
        .sort((a, b) => b.length - a.length);
    if (!secrets.length) return (text) => text;
    const pattern = new RegExp(secrets.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

    return (text) => text.replace(pattern, () => '[REDACTED SECRET]');

}

/** Reject executable templates before loading template data or executing SQL. */
export async function preflightCommand(command: string, input: unknown, ctx: Context): Promise<void> {

    const args = z.record(z.string(), z.unknown()).parse(input);
    const rejectTemplate = (filepath: string) => {

        if (isTemplate(filepath)) throw new Error('MCP confirmation does not support executable SQL templates');

    };
    const rejectChange = (files: ChangeFile[]) => {

        for (const file of files) {

            if (file.type === 'txt') {

                if (!file.resolvedPaths) throw new Error(`Manifest was not resolved: ${file.path}`);
                for (const filepath of file.resolvedPaths) rejectTemplate(filepath);

            }
            else rejectTemplate(file.path);

        }

    };

    if (command === 'run_file') rejectTemplate(z.string().parse(args['path']));
    else if (command === 'run_build') {

        const settings = ctx.noorm.settings;
        const config = ctx.noorm.config;
        const sqlPath = path.join(ctx.projectRoot, settings.paths?.sql ?? DEFAULT_SQL_PATH);
        const effective = getEffectiveBuildPaths(
            settings.build?.include ?? [], settings.build?.exclude ?? [], settings.rules ?? [],
            { name: config.name, access: config.access, isTest: config.isTest ?? false, type: config.type },
        );
        const files = filterFilesByPaths(await discoverFiles(sqlPath), sqlPath, effective.include, effective.exclude);
        for (const file of files) rejectTemplate(file);

    }
    else if (command === 'change_ff') {

        await ctx.connect();
        const history = new ChangeHistory(ctx.kysely as Kysely<NoormDatabase>, ctx.noorm.config.name, ctx.dialect);
        const statuses = await history.getAllStatuses();
        for (const change of await ctx.noorm.changes.discover()) {

            const status = statuses.get(change.name);
            if (!status || isPendingChange({ ...status, isNew: false, orphaned: false })) {

                rejectChange(change.changeFiles);

            }

        }

    }
    else if (command === 'change_run' || command === 'change_revert') {

        const change = await ctx.noorm.changes.parse(z.string().parse(args['name']));
        rejectChange(command === 'change_revert' ? change.revertFiles : change.changeFiles);

    }

}

/** Resolve a run_file target within the canonical project root. */
export async function resolveProjectFile(root: string, filepath: string): Promise<string> {

    if (path.isAbsolute(filepath)) throw new Error('run_file path must be relative to the project root');
    const canonicalRoot = await realpath(root);
    const target = await realpath(path.resolve(root, filepath));
    const relative = path.relative(canonicalRoot, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {

        throw new Error('run_file path must be inside the project root');

    }

    return path.resolve(root, relative);

}

/** Prepare only the effective SQL and plan. No database statements are executed. */
export async function prepareCommand(command: string, input: unknown, ctx: Context): Promise<PreparedCommand> {

    await preflightCommand(command, input, ctx);
    await ctx.connect();
    const args = z.record(z.string(), z.unknown()).parse(input);
    const fileCommand = ['run_file', 'run_build', 'change_run', 'change_ff', 'change_revert'].includes(command);
    const context = fileCommand ? await ctx.noorm.run[prepareRunContext]() : undefined;
    const redact = secretRedactor([
        ...Object.values(context?.secrets ?? {}),
        ...Object.values(context?.globalSecrets ?? {}),
        ...connectionSecrets(ctx.noorm.config.connection),
    ]);
    const summarize = (value: unknown) => JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'string' ? redact(item) : item, 2);
    const redactions = 'Redaction is best-effort; transformed secrets or credentials may still be visible.';
    if (!fileCommand) return { summary: summarize({ command, input, redactions }), run: (action) => action() };
    const sql = new Map<string, string>();
    const checksums = new Map<string, string>();
    const changes = new Map<string, string>();
    const review: { change?: string; file: string; sql: string }[] = [];
    let buildFiles: string[] | undefined;
    let pending: string[] | undefined;

    const addSql = async (filepath: string, change?: string): Promise<void> => {

        let rendered = sql.get(filepath);
        if (rendered === undefined) {

            if (isTemplate(filepath)) throw new Error('MCP confirmation does not support executable SQL templates');
            const source = await readFile(filepath, 'utf-8');
            rendered = source;
            sql.set(filepath, rendered);
            checksums.set(filepath, computeChecksumFromContent(source));

        }
        review.push({
            ...(change ? { change } : {}),
            file: filepath,
            sql: rendered,
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
        await addSql(path.isAbsolute(filepath) ? filepath : path.join(ctx.projectRoot, filepath));

    }
    else if (command === 'run_build') {

        const settings = ctx.noorm.settings;
        const config = ctx.noorm.config;
        const sqlPath = path.join(ctx.projectRoot, settings.paths?.sql ?? DEFAULT_SQL_PATH);
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
    const summary = summarize({ command, input, pending, files: review, redactions });

    return {
        summary,
        run: (action) => withApprovedContent(scope, action),
    };

}

