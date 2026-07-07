import { z } from 'zod';

import type { RpcCommand } from '../types.js';

const historySchema = z.object({
    limit: z.number().int().positive().optional().describe('Max number of history records to return'),
});

const changeNameSchema = z.object({
    name: z.string().describe('Change name'),
});

type HistoryInput = z.infer<typeof historySchema>;
type ChangeNameInput = z.infer<typeof changeNameSchema>;

const changeHistoryCommand: RpcCommand<HistoryInput> = {
    name: 'change_history',
    description: 'List applied changes with timestamps, identity, and checksums.',
    examples: [
        { description: 'get history', input: {} },
        { description: 'get last 5', input: { limit: 5 } },
    ],
    inputSchema: historySchema,
    permission: 'explore',
    handler: async (input, session) => {

        const { limit } = input;
        const ctx = session.getContext();

        return ctx.noorm.changes.history(limit);

    },
};

const changeRunCommand: RpcCommand<ChangeNameInput> = {
    name: 'change_run',
    description: 'Apply a specific change by name.',
    examples: [
        { description: 'apply a change', input: { name: '2026-01-15-add-users-table' } },
    ],
    inputSchema: changeNameSchema,
    permission: 'change:run',
    handler: async (input, session) => {

        const { name } = input;
        const ctx = session.getContext();

        return ctx.noorm.changes.apply(name);

    },
};

const changeFfCommand: RpcCommand<Record<string, never>> = {
    name: 'change_ff',
    description: 'Fast-forward: apply all pending changes in order.',
    examples: [
        { description: 'apply all pending', input: {} },
    ],
    inputSchema: z.object({}),
    permission: 'change:ff',
    handler: async (_input, session) => {

        const ctx = session.getContext();

        return ctx.noorm.changes.ff();

    },
};

const changeRevertCommand: RpcCommand<ChangeNameInput> = {
    name: 'change_revert',
    description: 'Revert a specific change by name.',
    examples: [
        { description: 'revert a change', input: { name: '2026-01-15-add-users-table' } },
    ],
    inputSchema: changeNameSchema,
    permission: 'change:revert',
    handler: async (input, session) => {

        const { name } = input;
        const ctx = session.getContext();

        return ctx.noorm.changes.revert(name);

    },
};

/** Database change management commands exposed over RPC. */
export const changesCommands: RpcCommand[] = [
    changeHistoryCommand as RpcCommand,
    changeRunCommand as RpcCommand,
    changeFfCommand as RpcCommand,
    changeRevertCommand as RpcCommand,
];
