import { z } from 'zod';

import type { RpcCommand } from '../types.js';

const buildSchema = z.object({
    force: z.boolean().optional().describe('Skip checksum checks, rebuild everything'),
});

const runFileSchema = z.object({
    path: z.string().describe('Path to the SQL file (relative to project root)'),
});

type BuildInput = z.infer<typeof buildSchema>;
type RunFileInput = z.infer<typeof runFileSchema>;

const runBuildCommand: RpcCommand<BuildInput> = {
    name: 'run_build',
    description: 'Build database schema from SQL files defined in settings. Applies only files that have changed since the last build (checksum-based).',
    examples: [
        { description: 'run build', input: {} },
        { description: 'force rebuild all', input: { force: true } },
    ],
    inputSchema: buildSchema,
    handler: async (input, session) => {

        const { force } = input;
        const ctx = session.getContext();

        return ctx.noorm.run.build({ force });

    },
};

const runFileCommand: RpcCommand<RunFileInput> = {
    name: 'run_file',
    description: 'Execute a single SQL file against the database.',
    examples: [
        { description: 'run a file', input: { path: 'sql/procedures/usp_get_user.sql' } },
    ],
    inputSchema: runFileSchema,
    handler: async (input, session) => {

        const { path } = input;
        const ctx = session.getContext();

        return ctx.noorm.run.file(path);

    },
};

/** SQL runner commands exposed over RPC. */
export const runCommands: RpcCommand[] = [
    runBuildCommand as RpcCommand,
    runFileCommand as RpcCommand,
];
