import { z } from 'zod';

import { executeRawSql } from '../../core/sql-terminal/executor.js';
import type { RpcCommand } from '../types.js';

const sqlSchema = z.object({
    query: z.string().describe('The SQL query to execute'),
});

type SqlInput = z.infer<typeof sqlSchema>;

const sqlCommand: RpcCommand<SqlInput> = {
    name: 'sql',
    description: 'Execute raw SQL. Every represented SQL permission is checked against the config\'s access role for the calling channel.',
    examples: [
        { description: 'simple select', input: { query: 'SELECT * FROM users LIMIT 10' } },
        { description: 'count rows', input: { query: 'SELECT COUNT(*) AS total FROM orders' } },
    ],
    inputSchema: sqlSchema,
    // MCP replaces this placeholder with the permissions represented by the
    // query; executeRawSql independently enforces the same policy at the seam.
    permission: 'sql:read',
    handler: async (input, session) => {

        const { query } = input;
        const ctx = session.getContext();
        const config = ctx.noorm.config;

        return executeRawSql(ctx.kysely, query, config.name, {
            access: config.access,
            channel: session.channel,
            dialect: ctx.dialect,
        }, session.signal);

    },
};

/** SQL query commands exposed over RPC. */
export const queryCommands: RpcCommand[] = [sqlCommand as RpcCommand];
