/**
 * noorm sql — SQL execution and history management.
 *
 * Subcommands: `query` (run a SQL statement), `history`, `clear`, `repl`.
 *
 * Note: citty resolves subcommands before the parent's positional args,
 * so `noorm sql "<SQL>"` would be interpreted as a subcommand named
 * `<SQL>` and fail with "Unknown command". To accommodate the natural
 * bare form, the top-level argv rewriter in `src/cli/index.ts` detects
 * a SQL-looking first argument after `sql` and rewrites it to
 * `sql query <SQL>` before dispatching to citty. Use `noorm sql query
 * "<SQL>"` for the explicit, always-correct form.
 */
import { defineCommand } from 'citty';

import query from './query.js';
import history from './history.js';
import clear from './clear.js';
import repl from './repl.js';

const sqlCommand = defineCommand({
    meta: {
        name: 'sql',
        description: 'Execute SQL and manage query history',
    },
    subCommands: { query, history, clear, repl },
});

(sqlCommand as typeof sqlCommand & { examples: string[] }).examples = [
    'noorm sql query "SELECT 1"',
    'noorm sql query -f reports/monthly.sql',
    'noorm sql query --json "SELECT id, name FROM users"',
    'noorm sql history',
    'noorm sql repl',
    'noorm sql repl --config dev',
];

export default sqlCommand;
