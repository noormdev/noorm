#!/usr/bin/env node
/**
 * CLI entry point for noorm.
 *
 * Parses command line arguments with meow, determines execution mode,
 * and either starts the TUI or runs in headless mode.
 *
 * @example
 * ```bash
 * # TUI mode (default)
 * noorm                     # Open home screen
 * noorm config              # Jump to config screen
 * noorm config edit prod    # Edit specific config
 *
 * # Headless mode
 * noorm -H run build        # Run build non-interactively
 * noorm --json change ff    # JSON output for scripting
 * ```
 */
import meow from 'meow';
import { render } from 'ink';

import type { Route, RouteParams, CliFlags, ParsedCli } from './types.js';
import { App } from './app.js';
import { shouldRunHeadless, runHeadless } from './headless/index.js';
import { enableAutoLoggerInit } from '../core/logger/init.js';
import { hasKeyFiles } from '../core/identity/storage.js';
import { initProjectContext } from '../core/project.js';

/**
 * Help text for the CLI.
 */
const HELP_TEXT = `
  Usage
    $ noorm [command] [subcommand] [options]

  Commands
    (none)               Open home screen (TUI mode)
    config               Manage database configurations
    config add           Add a new configuration
    config edit <name>   Edit a configuration
    config rm <name>     Remove a configuration
    config use <name>    Set active configuration

    change               Manage changes
    change add           Create a new change
    change run <name>    Apply a change
    change revert <name> Revert a change
    change next [count]  Apply next N pending changes
    change ff            Apply all pending changes
    change rewind [n]    Revert recent changes

    run build            Build schema from SQL files
    run file <path>      Execute a single SQL file
    run dir <path>       Execute all SQL in a directory

    db create            Create database and tracking tables
    db destroy           Drop all managed objects
    db explore           Explore database schema

    lock status          Show lock status
    lock acquire         Acquire lock
    lock release         Release lock
    lock force           Force release lock

    settings             View/edit project settings
    secret               Manage secrets
    identity             Manage identity

  Options
    --headless, -H       Force headless mode (no TUI)
    --tui, -T            Force TUI mode (ignore TTY detection)
    --json               Output JSON (headless mode only)
    --yes, -y            Skip confirmation prompts
    --config, -c <name>  Use specific configuration (defaults to active config)
    --force, -f          Force operation
    --dry-run            Preview without executing
    --help, -h           Show this help
    --version            Show version

  Examples
    $ noorm                            # Start TUI
    $ noorm config                     # Go to config screen
    $ noorm -H run build               # Build in CI
    $ noorm --json change ff           # Fast-forward with JSON output
    $ noorm -c prod change run users   # Run change on prod config
`;

/**
 * Parse CLI arguments with meow.
 */
function parseCli(): ParsedCli {

    const cli = meow(HELP_TEXT, {
        importMeta: import.meta,
        flags: {
            headless: {
                type: 'boolean',
                shortFlag: 'H',
                default: false,
            },
            tui: {
                type: 'boolean',
                shortFlag: 'T',
                default: false,
            },
            json: {
                type: 'boolean',
                default: false,
            },
            yes: {
                type: 'boolean',
                shortFlag: 'y',
                default: false,
            },
            config: {
                type: 'string',
                shortFlag: 'c',
            },
            force: {
                type: 'boolean',
                shortFlag: 'f',
                default: false,
            },
            dryRun: {
                type: 'boolean',
                default: false,
            },
        },
    });

    const flags: CliFlags = {
        headless: cli.flags.headless,
        tui: cli.flags.tui,
        json: cli.flags.json,
        yes: cli.flags.yes,
        config: cli.flags.config,
        force: cli.flags.force,
        dryRun: cli.flags.dryRun,
    };

    // Parse route from input
    const { route, params } = parseRouteFromInput(cli.input);

    // Determine execution mode
    const mode = shouldRunHeadless(flags) ? 'headless' : 'tui';

    return { mode, route, params, flags };

}

/**
 * Actions that always take a parameter as their next argument.
 * After these, stop building the route and treat remaining args as params.
 *
 * Note: Some actions are context-dependent. See isTerminalAction().
 */
const TERMINAL_ACTIONS = new Set([
    'help',     // help <topic> - everything after is the topic
    'use',      // config use <name>
    'edit',     // config edit <name>
    'rm',       // config rm <name>
    'add',      // config add (no param but terminal)
    'revert',   // change revert <name>
    'file',     // run file <path>
    'dir',      // run dir <path>
    'detail',   // db explore tables detail <name>
]);

/**
 * Check if a token is a terminal action in context.
 *
 * Some actions like "run" are only terminal in certain contexts:
 * - "change run <name>" - "run" is terminal (takes change name)
 * - "run build" - "run" is NOT terminal (build is a subcommand)
 */
function isTerminalAction(token: string, routeSegments: string[]): boolean {

    // Standard terminal actions
    if (TERMINAL_ACTIONS.has(token)) return true;

    // "run" is only terminal after "change" (for "change run <name>")
    if (token === 'run' && routeSegments.length > 0 && routeSegments[routeSegments.length - 1] === 'change') {

        return true;

    }

    return false;

}

/**
 * Check if a token looks like a route segment vs a parameter.
 *
 * Route segments are lowercase command words.
 * Parameters are paths, numbers, or names with special chars.
 */
function isRouteSegment(token: string): boolean {

    // Numbers are params (counts)
    if (/^\d+$/.test(token)) return false;

    // Paths are params (contain / or end with .sql/.eta)
    if (token.includes('/') || token.endsWith('.sql') || token.endsWith('.eta')) return false;

    // Route segments are lowercase letters only
    return /^[a-z]+$/.test(token);

}

/**
 * Parse route and params from CLI input array.
 *
 * Supports colon notation (config:edit), slash notation (config/edit),
 * and space notation (config edit). Multi-level routes are supported.
 *
 * @example
 * ```typescript
 * parseRouteFromInput(['config', 'edit', 'prod'])
 * // { route: 'config/edit', params: { name: 'prod' } }
 *
 * parseRouteFromInput(['db', 'explore', 'tables', 'detail'])
 * // { route: 'db/explore/tables/detail', params: {} }
 *
 * parseRouteFromInput(['config:edit', 'prod'])
 * // { route: 'config/edit', params: { name: 'prod' } }
 * ```
 */
function parseRouteFromInput(input: string[]): { route: Route; params: RouteParams } {

    if (input.length === 0) {

        return { route: 'home', params: {} };

    }

    const firstArg = input[0]!;

    // Handle colon notation (config:edit) - convert to slash
    if (firstArg.includes(':')) {

        const normalized = firstArg.replace(/:/g, '/');
        const params = extractParams(input.slice(1));

        return { route: normalized as Route, params };

    }

    // Handle slash notation passed directly (config/edit)
    if (firstArg.includes('/')) {

        const params = extractParams(input.slice(1));

        return { route: firstArg as Route, params };

    }

    // Handle space notation (db explore tables detail)
    // Consume tokens as route segments until we hit a parameter or terminal action
    const routeSegments: string[] = [];
    let paramStartIndex = 0;

    for (let i = 0; i < input.length; i++) {

        const token = input[i]!;

        if (isRouteSegment(token)) {

            routeSegments.push(token);
            paramStartIndex = i + 1;

            // If this is a terminal action in context, stop - next args are params
            if (isTerminalAction(token, routeSegments.slice(0, -1))) {

                break;

            }

        }
        else {

            // Found a parameter, stop building route
            break;

        }

    }

    const route = routeSegments.join('/') || 'home';
    const params = extractParams(input.slice(paramStartIndex));

    return { route: route as Route, params };

}

/**
 * Extract params from remaining CLI arguments.
 *
 * Convention:
 * - First positional arg is usually `name`
 * - Multiple name-like args are joined as `topic` (for help command)
 * - Numeric arg could be `count`
 * - Path-like arg is `path`
 */
function extractParams(args: string[]): RouteParams {

    if (args.length === 0) {

        return {};

    }

    const params: RouteParams = {};
    const nameArgs: string[] = [];

    for (const arg of args) {

        // Check if it's a number (for count parameter)
        const num = parseInt(arg, 10);

        if (!isNaN(num)) {

            params.count = num;
            continue;

        }

        // Check if it's a path (contains / or ends with .sql)
        if (arg.includes('/') || arg.endsWith('.sql') || arg.endsWith('.sql.eta')) {

            params.path = arg;
            continue;

        }

        // Collect name-like arguments
        nameArgs.push(arg);

    }

    // First name arg becomes `name`, all joined become `topic`
    if (nameArgs.length > 0) {

        params.name = nameArgs[0];

    }

    if (nameArgs.length > 1) {

        // Multiple args - join as topic (for help db explore tables)
        params.topic = nameArgs.join('/');

    }

    return params;

}

/**
 * Main entry point.
 */
async function main(): Promise<void> {

    // Discover project root by walking up directory tree
    // If found, process.chdir() to the project root so relative paths work
    // This enables running noorm from any subdirectory within a project
    const projectDiscovery = initProjectContext();

    // Enable event-driven logger initialization
    // This sets up listeners for settings:loaded and secret events
    // so the logger can start capturing events as soon as settings are loaded
    // Note: process.cwd() is now the project root if one was found
    enableAutoLoggerInit(process.cwd());

    const { mode, route, params, flags } = parseCli();

    // Check if identity exists (global keys or env var)
    const hasIdentity = await hasKeyFiles() || !!process.env['NOORM_IDENTITY'];

    if (mode === 'headless') {

        // In headless mode, require identity (except for init command)
        if (!hasIdentity && route !== 'init' && route !== 'identity/init') {

            console.error('No identity configured. Run: noorm init');
            process.exit(1);

        }

        // Run in headless mode
        const exitCode = await runHeadless(route, params, flags);
        process.exit(exitCode);

    }

    // Determine effective route based on identity and project status
    let effectiveRoute: Route = route;

    if (!hasIdentity) {

        // No identity - go to init screen for identity setup
        effectiveRoute = 'init';

    }
    else if (!projectDiscovery.hasProject && route === 'home') {

        // Has identity but no project found - go to init for project setup
        // Only redirect if user didn't explicitly request a different route
        effectiveRoute = 'init';

    }

    // Merge relevant flags into params for TUI mode
    const mergedParams = {
        ...params,
        // Pass force flag to init screen
        ...(flags.force && { force: true }),
    };

    // Start TUI mode
    const { waitUntilExit } = render(<App initialRoute={effectiveRoute} initialParams={mergedParams} />, {
        exitOnCtrlC: true,
        patchConsole: true,
    });

    await waitUntilExit();

}

// Run main
main().catch((error) => {

    console.error('Fatal error:', error);
    process.exit(1);

});
