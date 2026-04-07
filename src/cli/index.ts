#!/usr/bin/env node
/**
 * CLI entry point for noorm.
 *
 * Parses argv with citty, routes to the appropriate subcommand, and
 * intercepts --help to append per-command examples after citty's
 * auto-generated usage.
 */
import { defineCommand, runMain, renderUsage, type CommandDef } from 'citty';

import change from './change/index.js';
import config from './config/index.js';
import db from './db/index.js';
import dev from './dev/index.js';
import info from './info.js';
import lock from './lock/index.js';
import mcp from './mcp/index.js';
import run from './run/index.js';
import sql from './sql.js';
import ui from './ui.js';
import update from './update.js';
import vault from './vault/index.js';
import version from './version.js';

import { initProjectContext } from '../core/project.js';

/**
 * Commands opt into examples by attaching a top-level `examples: string[]`
 * property to their defineCommand result. The help interceptor reads it.
 */
export type CommandWithExamples = CommandDef & { examples?: string[] };

const main = defineCommand({
    meta: {
        name: 'noorm',
        version: '0.0.0', // replaced at bundle time via --define __CLI_VERSION__
        description: 'Database schema & changeset manager',
    },
    subCommands: {
        change,
        config,
        db,
        dev,
        info,
        lock,
        mcp,
        run,
        sql,
        ui,
        update,
        vault,
        version,
    },
});

/**
 * Walk argv one positional at a time to find the target command.
 *
 * Stops at the first flag (token starting with `-`) or unknown subcommand.
 * Returns the resolved command definition object.
 */
async function resolveCommand(rootDef: CommandDef, argv: string[]): Promise<CommandDef> {

    let current: unknown = rootDef;

    for (const arg of argv) {

        if (arg.startsWith('-')) break;

        const resolved = typeof current === 'function' ? await (current as () => Promise<CommandDef>)() : current as CommandDef;
        const subs = resolved.subCommands as Record<string, unknown> | undefined;
        const sub = subs?.[arg];
        if (!sub) {

            current = resolved;
            break;

        }
        current = sub;

    }

    return typeof current === 'function' ? await (current as () => Promise<CommandDef>)() : current as CommandDef;

}

/**
 * Print citty's usage followed by a custom EXAMPLES block from
 * the command's top-level `examples` property (if present).
 */
async function printHelpWithExamples(cmd: CommandWithExamples, rootDef: CommandDef): Promise<void> {

    const usage = await renderUsage(cmd, rootDef);
    process.stdout.write(usage + '\n');

    if (cmd.examples && cmd.examples.length > 0) {

        process.stdout.write('\nEXAMPLES\n\n');
        for (const ex of cmd.examples) {

            process.stdout.write('  ' + ex + '\n');

        }
        process.stdout.write('\n');

    }

}

/**
 * Entry point.
 *
 * 1. Discover project root and chdir into it
 * 2. Intercept --help before handing off to citty
 * 3. Delegate to runMain
 */
async function entry(): Promise<void> {

    initProjectContext();

    const rawArgs = process.argv.slice(2);

    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {

        const cmd = await resolveCommand(main as CommandDef, rawArgs);
        await printHelpWithExamples(cmd as CommandWithExamples, main as CommandDef);
        process.exit(0);

    }

    await runMain(main);

}

entry().catch((error) => {

    process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);

});
