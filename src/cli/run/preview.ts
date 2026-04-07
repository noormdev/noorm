/**
 * Headless: preview rendered SQL from a template.
 *
 * Renders a .sql.tmpl file and outputs the resulting SQL
 * without executing it against the database.
 *
 * @example
 * ```bash
 * noorm -H run preview sql/users/001_create.sql.tmpl
 * noorm -H --json run preview sql/core/05_Cron/Crons.sql.tmpl
 * noorm -H run preview sql/migrations/002.sql.tmpl > rendered.sql
 * ```
 */
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import { outputError, type HeadlessCommand } from './_helpers.js';
import { processFile } from '../../core/template/engine.js';
import { getStateManager } from '../../core/state/index.js';

export const help = `
# RUN PREVIEW

Render a .sql.tmpl file and output the resulting SQL

## Usage

    noorm run preview PATH
    noorm -H run preview PATH

## Arguments

    PATH    Path to the .sql.tmpl file

## Description

Renders a template file with the full context (config, secrets,
data files, helpers) and outputs the resulting SQL. Does not
execute the SQL against any database.

Useful for verifying template output, debugging directives,
and piping rendered SQL to other tools.

## Examples

    noorm -H run preview sql/users/001_create.sql.tmpl
    noorm -H run preview sql/core/05_Cron/Crons.sql.tmpl > rendered.sql
    noorm -H --json run preview sql/seed.sql.tmpl | jq -r .sql

## JSON Output

\`\`\`json
{
    "filepath": "sql/users/001_create.sql.tmpl",
    "sql": "CREATE TABLE users (\\n  id INT PRIMARY KEY\\n);",
    "durationMs": 12
}
\`\`\`

See \`noorm help run\` or \`noorm help run inspect\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!params.path) {

        return outputError(flags, logger, 'File path required. Usage: noorm -H run preview <file.sql.tmpl>');

    }

    const projectRoot = process.cwd();
    const fullPath = join(projectRoot, params.path);

    // Load state for config + secrets
    const stateManager = getStateManager(projectRoot);
    const [, loadErr] = await attempt(() => stateManager.load());

    if (loadErr) {

        return outputError(flags, logger, `Failed to load state: ${loadErr.message}`);

    }

    const activeConfigName = flags.config ?? stateManager.getActiveConfigName();
    const activeConfig = activeConfigName ? stateManager.getConfig(activeConfigName) : undefined;

    // Render the template
    const [result, err] = await attempt(() => processFile(fullPath, {
        projectRoot,
        config: activeConfig as unknown as Record<string, unknown>,
        secrets: activeConfigName ? stateManager.getAllSecrets(activeConfigName) : {},
        globalSecrets: stateManager.getAllGlobalSecrets(),
    }));

    if (err) {

        return outputError(flags, logger, err.stack ?? err.message);

    }

    if (flags.json) {

        logger.result({
            filepath: params.path,
            sql: result.sql,
            durationMs: result.durationMs,
        });

    }
    else {

        // Output raw SQL so it can be piped to a file or other tool
        process.stdout.write(result.sql);

        // Add trailing newline if the SQL doesn't end with one
        if (!result.sql.endsWith('\n')) {

            process.stdout.write('\n');

        }

    }

    return 0;

};
