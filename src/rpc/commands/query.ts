import { z } from 'zod';

import { executeRawSql } from '../../core/sql-terminal/executor.js';
import type { RpcCommand } from '../types.js';
import { RpcError } from '../types.js';
import { isReadOnlyStatement } from '../protection.js';

const sqlSchema = z.object({
    query: z.string().describe('The SQL query to execute'),
});

type SqlInput = z.infer<typeof sqlSchema>;

const sqlCommand: RpcCommand<SqlInput> = {
    name: 'sql',
    description: 'Execute a raw SQL query. On protected configs, only SELECT, EXPLAIN, SHOW, and DESCRIBE statements are allowed.',
    examples: [
        { description: 'simple select', input: { query: 'SELECT * FROM users LIMIT 10' } },
        { description: 'count rows', input: { query: 'SELECT COUNT(*) AS total FROM orders' } },
    ],
    inputSchema: sqlSchema,
    handler: async (input, session) => {

        const { query } = input;
        const ctx = session.getContext();
        const config = ctx.noorm.config;

        if (config.protected && !isReadOnlyStatement(query, ctx.dialect)) {

            throw new RpcError(
                `Config "${config.name}" is protected — only SELECT, EXPLAIN, SHOW, and DESCRIBE are allowed`,
            );

        }

        return executeRawSql(ctx.kysely, query, config.name);

    },
};

/** SQL query commands exposed over RPC. */
export const queryCommands: RpcCommand[] = [sqlCommand as RpcCommand];
