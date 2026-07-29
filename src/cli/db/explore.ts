/**
 * noorm db explore — explore database schema.
 *
 * Bare invocation shows an overview of tables/views/functions/procedures/types.
 * Subcommands allow drilling into specific object types.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

import tables from './explore-tables.js';
import views from './explore-views.js';
import procedures from './explore-procedures.js';
import functions from './explore-functions.js';
import types from './explore-types.js';
import indexes from './explore-indexes.js';
import fks from './explore-fks.js';
import triggers from './explore-triggers.js';

const exploreCommand = defineCommand({
    meta: {
        name: 'explore',
        description: 'Explore database schema',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    subCommands: { tables, views, procedures, functions, types, indexes, fks, triggers },
    async run({ args }) {

        const [overview, error] = await withContext({
            args,
            fn: (ctx) => ctx.noorm.db.overview(),
        });

        if (error) process.exit(1);

        // Every counter printed here has a subcommand that can list it.
        // locks/connections stay out: they are runtime state, not schema, and
        // no CLI listing exists for them (they remain in --json).
        const text = [
            'Database Overview',
            `  Tables:       ${overview.tables}`,
            `  Views:        ${overview.views}`,
            `  Functions:    ${overview.functions}`,
            `  Procedures:   ${overview.procedures}`,
            `  Types:        ${overview.types}`,
            `  Indexes:      ${overview.indexes}`,
            `  Foreign Keys: ${overview.foreignKeys}`,
            `  Triggers:     ${overview.triggers}`,
        ].join('\n');

        outputResult(args, overview, text);

        process.exit(0);

    },
});

(exploreCommand as typeof exploreCommand & { examples: string[] }).examples = [
    'noorm db explore',
    'noorm db explore --json',
    'noorm db explore tables',
    'noorm db explore tables detail users',
    'noorm db explore views',
    'noorm db explore procedures',
    'noorm db explore functions',
    'noorm db explore types',
    'noorm db explore indexes',
    'noorm db explore fks',
    'noorm db explore triggers',
];

export default exploreCommand;
