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
 * noorm config:edit prod    # Edit specific config
 *
 * # Headless mode
 * noorm -H run:build        # Run build non-interactively
 * noorm --json change:ff    # JSON output for scripting
 * ```
 */
import meow from 'meow'
import { render } from 'ink'

import type { Route, RouteParams, CliFlags, ParsedCli } from './types.js'
import { App } from './app.js'
import { shouldRunHeadless, runHeadless } from './headless.js'


/**
 * Help text for the CLI.
 */
const HELP_TEXT = `
  Usage
    $ noorm [command] [options]

  Commands
    (none)              Open home screen (TUI mode)
    config              Manage database configurations
    config:add          Add a new configuration
    config:edit <name>  Edit a configuration
    config:rm <name>    Remove a configuration
    config:use <name>   Set active configuration

    change              Manage changesets
    change:add          Create a new changeset
    change:run <name>   Apply a changeset
    change:revert <name> Revert a changeset
    change:next [count] Apply next N pending changesets
    change:ff           Apply all pending changesets
    change:rewind [n|name] Revert recent changesets

    run:build           Build schema from SQL files
    run:file <path>     Execute a single SQL file
    run:dir <path>      Execute all SQL in a directory

    db:create           Create database and tracking tables
    db:destroy          Drop all managed objects

    lock:status         Show lock status
    lock:acquire        Acquire lock
    lock:release        Release lock
    lock:force          Force release lock

    settings            View/edit project settings
    secret              Manage secrets
    identity            Manage identity

  Options
    --headless, -H      Force headless mode (no TUI)
    --tui, -T           Force TUI mode (ignore TTY detection)
    --json              Output JSON (headless mode only)
    --yes, -y           Skip confirmation prompts
    --config, -c <name> Use specific configuration
    --force, -f         Force operation
    --dry-run           Preview without executing
    --help, -h          Show this help
    --version           Show version

  Examples
    $ noorm                           # Start TUI
    $ noorm config                    # Go to config screen
    $ noorm -H run:build              # Build in CI
    $ noorm --json change:ff          # Fast-forward with JSON output
    $ noorm -c prod change:run users  # Run changeset on prod config
`


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
                default: false
            },
            tui: {
                type: 'boolean',
                shortFlag: 'T',
                default: false
            },
            json: {
                type: 'boolean',
                default: false
            },
            yes: {
                type: 'boolean',
                shortFlag: 'y',
                default: false
            },
            config: {
                type: 'string',
                shortFlag: 'c'
            },
            force: {
                type: 'boolean',
                shortFlag: 'f',
                default: false
            },
            dryRun: {
                type: 'boolean',
                default: false
            }
        }
    })

    const flags: CliFlags = {
        headless: cli.flags.headless,
        tui: cli.flags.tui,
        json: cli.flags.json,
        yes: cli.flags.yes,
        config: cli.flags.config,
        force: cli.flags.force,
        dryRun: cli.flags.dryRun
    }

    // Parse route from input
    const { route, params } = parseRouteFromInput(cli.input)

    // Determine execution mode
    const mode = shouldRunHeadless(flags) ? 'headless' : 'tui'

    return { mode, route, params, flags }
}


/**
 * Parse route and params from CLI input array.
 *
 * Supports both colon notation (config:edit) and space notation (config edit).
 *
 * @example
 * ```typescript
 * parseRouteFromInput(['config', 'edit', 'prod'])
 * // { route: 'config/edit', params: { name: 'prod' } }
 *
 * parseRouteFromInput(['config:edit', 'prod'])
 * // { route: 'config/edit', params: { name: 'prod' } }
 * ```
 */
function parseRouteFromInput(input: string[]): { route: Route; params: RouteParams } {

    if (input.length === 0) {

        return { route: 'home', params: {} }
    }

    // Handle colon notation (config:edit)
    const firstArg = input[0]!

    if (firstArg.includes(':')) {

        const [section, action] = firstArg.split(':')
        const route = action ? `${section}/${action}` : section
        const params = extractParams(input.slice(1))

        return { route: route as Route, params }
    }

    // Handle space notation (config edit)
    const [section, ...rest] = input

    // Check if second arg is an action or a param
    const actions = new Set([
        'add', 'edit', 'rm', 'cp', 'use', 'validate', 'export', 'import',
        'set', 'run', 'revert', 'rewind', 'next', 'ff',
        'list', 'build', 'exec', 'file', 'dir',
        'create', 'destroy',
        'status', 'acquire', 'release', 'force',
        'init'
    ])

    if (rest.length > 0 && actions.has(rest[0]!)) {

        const action = rest[0]!
        const route = `${section}/${action}` as Route
        const params = extractParams(rest.slice(1))

        return { route, params }
    }

    // Just a section route with params
    const params = extractParams(rest)

    return { route: section as Route, params }
}


/**
 * Extract params from remaining CLI arguments.
 *
 * Convention:
 * - First positional arg is usually `name`
 * - Numeric arg could be `count`
 * - Path-like arg is `path`
 */
function extractParams(args: string[]): RouteParams {

    if (args.length === 0) {

        return {}
    }

    const params: RouteParams = {}

    for (const arg of args) {

        // Check if it's a number (for count parameter)
        const num = parseInt(arg, 10)

        if (!isNaN(num)) {

            params.count = num
            continue
        }

        // Check if it's a path (contains / or ends with .sql)
        if (arg.includes('/') || arg.endsWith('.sql') || arg.endsWith('.sql.eta')) {

            params.path = arg
            continue
        }

        // Default to name parameter
        if (!params.name) {

            params.name = arg
        }
    }

    return params
}


/**
 * Main entry point.
 */
async function main(): Promise<void> {

    const { mode, route, params, flags } = parseCli()

    if (mode === 'headless') {

        // Run in headless mode
        const exitCode = await runHeadless(route, params, flags)
        process.exit(exitCode)
    }

    // Merge relevant flags into params for TUI mode
    const mergedParams = {
        ...params,
        // Pass force flag to init screen
        ...(flags.force && { force: true }),
    }

    // Start TUI mode
    const { waitUntilExit } = render(
        <App initialRoute={route} initialParams={mergedParams} />,
        {
            exitOnCtrlC: true,
            patchConsole: true
        }
    )

    await waitUntilExit()
}


// Run main
main().catch((error) => {

    console.error('Fatal error:', error)
    process.exit(1)
})
