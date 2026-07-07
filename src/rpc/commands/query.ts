import { z } from 'zod';

import { executeRawSql } from '../../core/sql-terminal/executor.js';
import { checkConfigPolicy, classifyStatements } from '../../core/policy/index.js';
import type { Permission, SqlClass } from '../../core/policy/index.js';
import type { RpcCommand } from '../types.js';
import { RpcError } from '../types.js';

const sqlSchema = z.object({
    query: z.string().describe('The SQL query to execute'),
});

type SqlInput = z.infer<typeof sqlSchema>;

/** Maps a classified statement to the permission it's gated by. */
const CLASS_PERMISSION: Record<SqlClass, Permission> = {
    read: 'sql:read',
    write: 'sql:write',
    ddl: 'sql:ddl',
};

const sqlCommand: RpcCommand<SqlInput> = {
    name: 'sql',
    description: 'Execute a raw SQL query. The statement is classified (read/write/ddl) and checked against the config\'s access role for the calling channel.',
    examples: [
        { description: 'simple select', input: { query: 'SELECT * FROM users LIMIT 10' } },
        { description: 'count rows', input: { query: 'SELECT COUNT(*) AS total FROM orders' } },
    ],
    inputSchema: sqlSchema,
    // Dispatch gates on 'sql:read' (always allowed); the actual class is
    // checked here once the query text is known.
    permission: 'sql:read',
    handler: async (input, session) => {

        const { query } = input;
        const ctx = session.getContext();
        const config = ctx.noorm.config;

        const statementClass = classifyStatements(query, ctx.dialect);
        const check = checkConfigPolicy(session.channel, config, CLASS_PERMISSION[statementClass]);

        if (!check.allowed) {

            throw new RpcError(check.blockedReason ?? `"${CLASS_PERMISSION[statementClass]}" is not allowed on config "${config.name}"`);

        }

        return executeRawSql(ctx.kysely, query, config.name);

    },
};

/** SQL query commands exposed over RPC. */
export const queryCommands: RpcCommand[] = [sqlCommand as RpcCommand];
