/**
 * noorm config export — export a configuration to JSON.
 *
 * Writes the full config object (including sensitive fields) to stdout
 * or to a file when --output is provided. Intended for backup and
 * cross-machine transfer workflows where the user explicitly owns the data.
 *
 * The payload carries the connection password in plaintext, so the command
 * refuses to write to a terminal: --output chmods 0600, and a TTY offers no
 * equivalent. Redirects and pipes are allowed and warn on stderr, because a
 * shell redirect lands at the caller's umask and cannot make that guarantee.
 */
import { chmod, writeFile } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import { initState, getStateManager } from '../../core/state/index.js';
import { outputError, outputResult, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const exportCommand = defineCommand({
    meta: {
        name: 'export',
        description: 'Export a configuration to JSON',
    },
    args: {
        name: { type: 'positional', description: 'Config name to export', required: true },
        output: { type: 'string', alias: 'o', description: 'Write output to file instead of stdout' },
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();

        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(args, `Failed to load state: ${initErr.message}`);
            process.exit(EXIT.FAILURE);

        }

        const stateManager = getStateManager(projectRoot);
        const config = stateManager.getConfig(args.name);

        if (!config) {

            outputError(args, `Config not found: ${args.name}`);
            process.exit(EXIT.USAGE);

        }

        // The export carries the connection password in plaintext, so it is
        // a secret read — a viewer role that is denied `config:rm` must not
        // be able to walk away with the credential instead.
        const check = checkConfigPolicy(resolveChannel(), config, 'secret:read');

        if (!check.allowed) {

            outputError(args, check.blockedReason ?? `Config "${args.name}" cannot be exported.`);
            process.exit(EXIT.FAILURE);

        }

        const json = JSON.stringify(config, null, 4);

        // Writing the payload to a terminal is different from piping it to a
        // file. `--output` chmods 0600 precisely because this content carries
        // a plaintext password; a TTY has no such protection and keeps it in
        // scrollback, on screen, and in any recorded session. Redirects and
        // pipes still work, so `config export dev > dev.json` is unaffected.
        if (!args.output && process.stdout.isTTY) {

            outputError(
                args,
                `Refusing to print config "${args.name}" to a terminal: the export contains the `
                + 'connection password in plaintext. Use --output <file> to write it at 0600, or '
                + 'redirect stdout to a file.',
            );
            process.exit(EXIT.USAGE);

        }

        // A shell redirect lands at the caller's umask, so the one guarantee
        // --output makes cannot be made here. stdout has to stay clean JSON
        // for `config import`, so this goes to stderr.
        if (!args.output) {

            process.stderr.write(
                'Warning: this export contains the connection password in plaintext. '
                + 'The destination is not permission-protected; use --output to write at 0600.\n',
            );

        }

        if (args.output) {

            const [, writeErr] = await attempt(() =>
                writeFile(args.output as string, json, { encoding: 'utf8', mode: 0o600 }),
            );

            if (writeErr) {

                outputError(args, `Failed to write file: ${writeErr.message}`);
                process.exit(EXIT.FAILURE);

            }

            // Ensure permissions are correct (writeFile mode may not work on all platforms)
            await attempt(() => chmod(args.output as string, 0o600));

            outputResult(
                args,
                { name: args.name, output: args.output },
                `Config '${args.name}' exported to ${args.output}`,
            );

        }
        else if (args.json) {

            // `--json` gets the envelope like every other command. The bare
            // artifact — the shape `config import` reads — stays on the
            // default path, so `config export dev > dev.json` is unchanged.
            outputResult(args, { name: args.name, config }, '');

        }
        else {

            process.stdout.write(json + '\n');

        }

        process.exit(EXIT.SUCCESS);

    },
});

(exportCommand as typeof exportCommand & { examples: string[] }).examples = [
    'noorm config export dev > dev-config.json',
    'noorm config export dev --output ./dev-config.json',
];

export default exportCommand;
