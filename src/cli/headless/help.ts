import { type HeadlessCommand, type RouteHandler } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

let handlers: Partial<Record<string, RouteHandler>>;

export const help = `
# HELP

Show help for commands

## Usage

    noorm help [command] [subcommand]
    noorm -H help [command]

## Description

Displays help information for noorm commands.
Without arguments, lists all available commands.

## Examples

    noorm help
    noorm help config
    noorm help config use
    noorm -H help change ff

See \`noorm help config\`, \`noorm help change\`, or \`noorm help run\` for more.
`;

/**
 * Generate a list of available help topics from registered handlers.
 * Groups by top-level command and includes subcommands.
 */
function generateTopicsList(): string {

    if (!handlers) {

        return '';

    }

    // Get all routes and organize by top-level command
    const routes = Object.keys(handlers)
        .filter(r => r !== 'help')
        .sort();

    // Group by top-level command
    const groups: Record<string, string[]> = {};

    for (const route of routes) {

        const parts = route.split('/');
        const topLevel = parts[0]!;

        if (!groups[topLevel]) {

            groups[topLevel] = [];

        }

        if (parts.length > 1) {

            groups[topLevel].push(parts.slice(1).join(' '));

        }

    }

    // Build output
    const lines: string[] = ['## Available Commands', ''];

    for (const [cmd, subcommands] of Object.entries(groups)) {

        if (subcommands.length === 0) {

            lines.push(`    ${cmd}`);

        }
        else {

            const subs = subcommands.join(', ');
            lines.push(`    ${cmd.padEnd(12)} ${subs}`);

        }

    }

    lines.push('');
    lines.push('Run `noorm help <command>` for detailed help on any command.');

    return lines.join('\n');

}

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (!handlers) {

        throw new Error('Handlers not initialized');

    }

    // No topic specified - show help overview with available commands
    if (!params.name) {

        const topicsList = generateTopicsList();
        const fullHelp = `${help}\n${topicsList}`;
        const output = flags.json ? fullHelp : formatHelp(fullHelp);

        process.stdout.write(`${output}\n`);

        return 0;

    }

    const route = params.name.replace(' ', '/');

    const handler = handlers[route];

    if (!handler) {

        logger.error(`Unknown command: ${route.replace('/', ' ')}`);

        return 1;

    }

    const helpText = handler.help || 'No help available for this command.';

    // Apply colors unless --json mode
    const output = flags.json ? helpText : formatHelp(helpText);

    process.stdout.write(`${output}\n`);

    return 0;

};

export const factory = (
    registeredHandlers: Partial<Record<string, RouteHandler>>,
): RouteHandler => {

    handlers = registeredHandlers;

    return {
        run,
        help,
    };

};
