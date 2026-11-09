import type { McpServer } from '@modelcontextprotocol/server';
import { Eta } from 'eta';
import { z } from 'zod';

import gettingStarted from './prompts/getting-started.md' with { type: 'text' };
import exploreDatabase from './prompts/explore-database.md' with { type: 'text' };
import queryDatabase from './prompts/query-database.md' with { type: 'text' };
import applyChange from './prompts/apply-change.md' with { type: 'text' };
import buildDatabase from './prompts/build-database.md' with { type: 'text' };
import runSqlFile from './prompts/run-sql-file.md' with { type: 'text' };
import automation from './prompts/automation.md' with { type: 'text' };
import ci from './prompts/ci.md' with { type: 'text' };
import safety from './prompts/safety.md' with { type: 'text' };

const configArgument = z.string().min(1).describe('Exact noorm config name');
const call = (name: string, args: Record<string, unknown>): string => JSON.stringify({ name, arguments: args });
const eta = new Eta({ tags: ['{%', '%}'], varName: '$', autoEscape: false, autoTrim: [false, false], useWith: false });

function message(template: string, args: Record<string, string | undefined>) {

    const text = eta.renderString(template, { ...args, call, safety: safety.trim() }).trim();

    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };

}

/** Register user-selected guidance; retrieving a prompt never connects to a database. */
export function registerNoormPrompts(server: McpServer): void {

    server.registerPrompt('noorm_getting_started', {
        description: 'Discover configs and begin exploring a selected database.',
        argsSchema: z.object({ config: configArgument.optional() }),
    }, (args) => message(gettingStarted, args));

    server.registerPrompt('noorm_explore_database', {
        description: 'Explore a database and inspect its objects.',
        argsSchema: z.object({ config: configArgument }),
    }, (args) => message(exploreDatabase, args));

    server.registerPrompt('noorm_query_database', {
        description: 'Inspect schema and answer a database question with SQL.',
        argsSchema: z.object({ config: configArgument, question: z.string().optional().describe('Question to answer') }),
    }, (args) => message(queryDatabase, args));

    server.registerPrompt('noorm_apply_change', {
        description: 'Review and apply a specific named change.',
        argsSchema: z.object({ config: configArgument, change: z.string().min(1).describe('Exact change name') }),
    }, (args) => message(applyChange, args));

    server.registerPrompt('noorm_build_database', {
        description: 'Review and run the configured database build.',
        argsSchema: z.object({ config: configArgument }),
    }, (args) => message(buildDatabase, args));

    server.registerPrompt('noorm_run_sql_file', {
        description: 'Review and run a specific project SQL file.',
        argsSchema: z.object({ config: configArgument, path: z.string().min(1).describe('Project-relative SQL file path') }),
    }, (args) => message(runSqlFile, args));

    server.registerPrompt('noorm_automation', {
        description: 'Write a headless noorm script with explicit targets, structured output, and failure handling.',
        argsSchema: z.object({
            task: z.string().min(1).describe('Database workflow to automate'),
            config: configArgument.optional(),
        }),
    }, (args) => message(automation, args));

    server.registerPrompt('noorm_ci', {
        description: 'Create a test or deployment pipeline with noorm bootstrap, secret handling, and explicit targets.',
        argsSchema: z.object({
            provider: z.string().min(1).describe('CI provider, such as GitHub Actions or GitLab CI'),
            target: z.enum(['test', 'deploy']).describe('Disposable test database or shared deployment database'),
            config: configArgument,
        }),
    }, (args) => message(ci, args));

}
