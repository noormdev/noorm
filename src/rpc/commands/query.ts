import { z } from 'zod';

import { executeRawSql } from '../../core/sql-terminal/executor.js';
import type { RpcCommand } from '../types.js';

const sqlSchema = z.object({
    query: z.string().describe('The SQL query to execute'),
});

type SqlInput = z.infer<typeof sqlSchema>;

const sqlCommand: RpcCommand<SqlInput> = {
    name: 'sql',
    description: 'Execute a raw SQL query. The statement is classified (read/write/ddl) and checked against the config\'s access role for the calling channel.',
    examples: [
        { description: 'simple select', input: { query: 'SELECT * FROM users LIMIT 10' } },
        { description: 'count rows', input: { query: 'SELECT COUNT(*) AS total FROM orders' } },
    ],
    inputSchema: sqlSchema,
    // Dispatch gates on 'sql:read' (always allowed); the actual class is
    // checked by executeRawSql itself once the query text is known — the
    // single sql-gate seam shared with the CLI and TUI SQL terminal.
    permission: 'sql:read',
    handler: async (input, session) => {

        const { query } = input;
        const ctx = session.getContext();
        const config = ctx.noorm.config;

        return executeRawSql(ctx.kysely, query, config.name, {
            access: config.access,
            channel: session.channel,
            dialect: ctx.dialect,
        });

    },
};

/** SQL query commands exposed over RPC. */
export const queryCommands: RpcCommand[] = [sqlCommand as RpcCommand];
