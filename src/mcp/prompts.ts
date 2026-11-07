import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const configArgument = z.string().min(1).describe('Exact noorm config name');
const call = (name: string, args: Record<string, unknown>): string => JSON.stringify({ name, arguments: args });
const message = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

const safety = 'Use the exact config and target supplied. Read first and report what you find; do not invent objects or change names. For SQL, use the target dialect and inspect schema before writing a bounded query. Role policy applies: operator and admin allow DML by default without a prompt. Never use yes flags or overrides to bypass policy. If a tool requires confirmation, the client must obtain human approval through MCP elicitation; stop on denial or unavailable elicitation.';

/** Register static, user-selected guidance; retrieving a prompt never connects to a database. */
export function registerNoormPrompts(server: McpServer): void {

    server.registerPrompt('noorm_getting_started', {
        description: 'Discover configs and begin exploring a selected database.',
        argsSchema: z.object({ config: configArgument.optional() }),
    }, ({ config }) => message([
        'Help me get started with noorm.',
        `1. Discover visible configs: ${call('list_configs', {})}`,
        config
            ? `2. Check that ${JSON.stringify(config)} is the intended target and inspect it: ${call('overview', { config })}`
            : '2. Ask me to choose an exact config from the results before making database-scoped calls.',
        '3. List relevant object categories and inspect their details before answering.',
        safety,
    ].join('\n')));

    server.registerPrompt('noorm_explore_database', {
        description: 'Explore a database and inspect its objects.',
        argsSchema: z.object({ config: configArgument }),
    }, ({ config }) => message([
        `Explore the database for config ${JSON.stringify(config)}.`,
        `1. Inspect the target and object counts: ${call('overview', { config })}`,
        `2. List tables: ${call('list', { config, category: 'tables' })}`,
        `3. For each relevant object returned, call detail with its exact name and schema when applicable; for example, if the list contains sales.orders: ${call('detail', { config, category: 'tables', name: 'orders', schema: 'sales' })}`,
        'Summarize the observed schema and relationships; metadata resources may also be used.',
        safety,
    ].join('\n')));

    server.registerPrompt('noorm_query_database', {
        description: 'Inspect schema and answer a database question with SQL.',
        argsSchema: z.object({ config: configArgument, question: z.string().optional().describe('Question to answer') }),
    }, ({ config, question }) => message([
        `Answer a database question for config ${JSON.stringify(config)}.`,
        question ? `Question: ${JSON.stringify(question)}` : 'Ask me what question to answer before querying.',
        `1. Discover the target dialect: ${call('list_configs', {})}`,
        `2. Inspect the database: ${call('overview', { config })} then ${call('list', { config, category: 'tables' })}`,
        `3. Inspect relevant returned objects with detail; for example, if the list contains orders: ${call('detail', { config, category: 'tables', name: 'orders' })}`,
        `4. Construct a read-only, bounded query using observed names and the target dialect, then call sql. Example for a dialect supporting LIMIT after verifying an orders table and id column: ${call('sql', { config, query: 'SELECT id FROM orders LIMIT 10' })}`,
        'Explain the result and any limitations. Do not execute the example unless its assumptions hold.',
        safety,
    ].join('\n')));

    server.registerPrompt('noorm_apply_change', {
        description: 'Review and apply a specific named change.',
        argsSchema: z.object({ config: configArgument, change: z.string().min(1).describe('Exact change name') }),
    }, ({ config, change }) => message([
        `Apply the exact change ${JSON.stringify(change)} to config ${JSON.stringify(config)} only after review.`,
        `1. Inspect the target: ${call('list_configs', {})} and ${call('overview', { config })}`,
        `2. Review applied history: ${call('change_history', { config })}. Inspect the named change and its SQL in the project before executing; history is not a pending-change list.`,
        `3. Once the target and change are understood, request: ${call('change_run', { config, name: change })}`,
        'Review the result and report what actually ran.',
        safety,
    ].join('\n')));

    server.registerPrompt('noorm_build_database', {
        description: 'Review and run the configured database build.',
        argsSchema: z.object({ config: configArgument }),
    }, ({ config }) => message([
        `Build the database for config ${JSON.stringify(config)} only after review.`,
        `1. Inspect the target: ${call('list_configs', {})} and ${call('overview', { config })}`,
        '2. Review the project build settings and relevant SQL files; check the intended target and effects.',
        `3. Run the checksum-based build: ${call('run_build', { config })}`,
        'Report the result. Do not force a rebuild unless explicitly requested.',
        safety,
    ].join('\n')));

    server.registerPrompt('noorm_run_sql_file', {
        description: 'Review and run a specific project SQL file.',
        argsSchema: z.object({ config: configArgument, path: z.string().min(1).describe('Project-relative SQL file path') }),
    }, ({ config, path }) => message([
        `Run the project SQL file ${JSON.stringify(path)} against config ${JSON.stringify(config)} only after review.`,
        `1. Inspect the target and dialect: ${call('list_configs', {})} and ${call('overview', { config })}`,
        '2. Read the exact file and relevant project template context; inspect its effects and verify it is appropriate for the target dialect.',
        `3. Request execution of that file: ${call('run_file', { config, path })}`,
        'Report the result and any errors.',
        safety,
    ].join('\n')));

    server.registerPrompt('noorm_automation', {
        description: 'Write a headless noorm script with explicit targets, structured output, and failure handling.',
        argsSchema: z.object({
            task: z.string().min(1).describe('Database workflow to automate'),
            config: configArgument.optional(),
        }),
    }, ({ task, config }) => message([
        `Help me automate this noorm workflow: ${JSON.stringify(task)}.`,
        config
            ? `Use the saved config ${JSON.stringify(config)} explicitly on each database command.`
            : 'Inspect the project to choose a saved config or environment-only connection; ask if the intended target is unclear.',
        '1. Read existing scripts, package commands, .noorm/settings.yml, and the relevant SQL/change files. Check the installed CLI command help before choosing flags.',
        '2. For environment-only connections, require NOORM_CONNECTION_DIALECT and NOORM_CONNECTION_DATABASE plus the dialect-specific connection variables. Read credentials from the environment or a secret store, never inline or log them.',
        '3. Write a script using supported headless commands such as noorm run build, noorm change ff, or noorm run file. Choose the operation for the requested task; do not rebuild or reset a populated database as a deployment shortcut.',
        '4. For a shell script, use set -euo pipefail and quote arguments. Use --json when consuming command results, keep stderr separate, and propagate nonzero exit codes. Exit 3 means partial success: inspect state before repair, not blind retry.',
        '5. Verify against a disposable target first and report the commands, target, observed output, and failure behavior. Do not execute against a shared database unless explicitly requested.',
        'Agent CLI calls cannot satisfy confirm permissions, even with --yes or NOORM_YES. Do not change NOORM_CHANNEL, roles, or policy to evade that boundary. MCP operations requiring confirmation must use human elicitation.',
        'For an independently authorized human-run script, document any required --yes confirmation per command; it never overrides deny. Do not set blanket NOORM_YES as a workaround for agent refusal.',
    ].join('\n')));

    server.registerPrompt('noorm_ci', {
        description: 'Create a test or deployment pipeline with noorm bootstrap, secret handling, and explicit targets.',
        argsSchema: z.object({
            provider: z.string().min(1).describe('CI provider, such as GitHub Actions or GitLab CI'),
            target: z.enum(['test', 'deploy']).describe('Disposable test database or shared deployment database'),
            config: configArgument,
        }),
    }, ({ provider, target, config }) => message([
        `Set up a ${JSON.stringify(provider)} noorm pipeline for ${JSON.stringify(target)} using config ${JSON.stringify(config)}.`,
        '1. Inspect existing workflow files, package scripts, .noorm/settings.yml, SQL, and changes. Follow the repository CI conventions and pin the noorm version. Generate the workflow for the requested provider, not an unrelated CI syntax.',
        '2. Run from the noorm project directory. Supply NOORM_CONNECTION_DIALECT and NOORM_CONNECTION_DATABASE plus the required connection variables through CI environment/secret mappings. Wait for database readiness; never print credentials or private keys.',
        ...(target === 'test' ? [
            '3. Provision a disposable database. An environment-only build needs no saved config or identity. If SDK tests use requireTest, provide a throwaway CI identity through NOORM_IDENTITY_PRIVATE_KEY, NOORM_IDENTITY_NAME, and NOORM_IDENTITY_EMAIL, then run noorm ci init with --test and --name set to the supplied config before building. Ensure tests select that stored test config.',
            '4. Run noorm run build, then noorm change ff, then the actual project test command. This checks that changes can replay against the built schema; never use a shared or production database.',
        ] : [
            '3. Use a previously enrolled deployment identity via NOORM_IDENTITY_PRIVATE_KEY, NOORM_IDENTITY_NAME, and NOORM_IDENTITY_EMAIL. Enrollment is a one-time human-admin action with vault access, not a step to repeat in every job.',
            '4. Run noorm ci init with --name set to the supplied config; preserve its intended project stage. Apply only pending changes with noorm change ff against that config. Do not run a schema build, reset, or teardown against an existing deployment database.',
            '5. Restrict deployment credentials to trusted jobs and use the CI provider deployment approval/environment controls. Serialize deployments targeting the same database; do not force-release another job lock.',
        ]),
        'Use --config or NOORM_CONFIG for the supplied name after ci init creates it. In environment-only mode, do not pass --config for a nonexistent saved config.',
        'Use fresh runner state; do not cache, commit, or publish .noorm/state/state.enc, identity files, or secret-bearing output. Do not overwrite existing state with --force by default.',
        'Fail the job on any nonzero exit. Exit 3 indicates partial success and requires inspection before repair or rerun. Report the generated workflow and validation performed; creating it does not authorize deployment.',
        'Agent CLI confirm permissions remain denied even with --yes or NOORM_YES. Never switch NOORM_CHANNEL or relax roles to evade denial. A separately authorized deployment job may use scoped user-channel confirmation flags under its reviewed policy; deny remains deny. MCP execution must collect human elicitation when required.',
    ].join('\n')));

}
