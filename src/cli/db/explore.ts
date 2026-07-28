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

const exploreCommand = defineCommand({
    meta: {
        name: 'explore',
        description: 'Explore database schema',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    subCommands: { tables, views, procedures, functions, types, indexes, fks },
    async run({ args }) {

        const [overview, error] = await withContext({
            args,
            fn: (ctx) => ctx.noorm.db.overview(),
        });

        if (error) process.exit(1);

        const text = [
            'Database Overview',
            `  Tables:     ${overview.tables}`,
            `  Views:      ${overview.views}`,
            `  Functions:  ${overview.functions}`,
            `  Procedures: ${overview.procedures}`,
            `  Types:      ${overview.types}`,
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
];

export default exploreCommand;
