import { z } from 'zod';

import { fetchOverview, fetchList, fetchDetail } from '../../core/explore/operations.js';
import type { RpcCommand } from '../types.js';

const categoryEnum = z.enum([
    'tables', 'views', 'procedures', 'functions',
    'types', 'indexes', 'foreignKeys', 'triggers',
    'locks', 'connections',
]);

const detailCategoryEnum = z.enum([
    'tables', 'views', 'procedures', 'functions', 'types', 'triggers',
]);

const listSchema = z.object({
    category: categoryEnum.describe('Object category to list'),
});

const detailSchema = z.object({
    category: detailCategoryEnum.describe('Object category'),
    name: z.string().describe('Object name'),
    schema: z.string().optional().describe('Schema name (e.g., "public", "dbo")'),
});

type ListInput = z.infer<typeof listSchema>;
type DetailInput = z.infer<typeof detailSchema>;

const overviewCommand: RpcCommand<Record<string, never>> = {
    name: 'overview',
    description: 'Get database overview with counts of all object types (tables, views, procedures, functions, types, indexes, foreign keys, triggers, locks, connections).',
    examples: [
        { description: 'get overview', input: {} },
    ],
    inputSchema: z.object({}),
    handler: async (_input, session) => {

        const ctx = session.getContext();

        return fetchOverview(ctx.kysely, ctx.dialect);

    },
};

const listCommand: RpcCommand<ListInput> = {
    name: 'list',
    description: 'List database objects by category. Returns summaries with names, schemas, and category-specific metadata.',
    examples: [
        { description: 'list all tables', input: { category: 'tables' } },
        { description: 'list procedures', input: { category: 'procedures' } },
        { description: 'list foreign keys', input: { category: 'foreignKeys' } },
    ],
    inputSchema: listSchema,
    handler: async (input, session) => {

        const { category } = input;
        const ctx = session.getContext();

        return fetchList(ctx.kysely, ctx.dialect, category);

    },
};

const detailCommand: RpcCommand<DetailInput> = {
    name: 'detail',
    description: 'Get full detail for a specific database object. For tables: columns with types, nullability, primary key status, defaults, plus indexes and foreign keys. For procedures/functions: parameters, return type, source.',
    examples: [
        { description: 'describe a table', input: { category: 'tables', name: 'users' } },
        { description: 'describe a table in a schema', input: { category: 'tables', name: 'orders', schema: 'sales' } },
        { description: 'view procedure detail', input: { category: 'procedures', name: 'usp_GetUser' } },
    ],
    inputSchema: detailSchema,
    handler: async (input, session) => {

        const { category, name, schema } = input;
        const ctx = session.getContext();

        return fetchDetail(ctx.kysely, ctx.dialect, category, name, schema);

    },
};

/** Database schema exploration commands exposed over RPC. */
export const exploreCommands: RpcCommand[] = [
    overviewCommand as RpcCommand,
    listCommand as RpcCommand,
    detailCommand as RpcCommand,
];
