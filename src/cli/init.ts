/**
 * noorm init — interactive project bootstrap.
 *
 * Strictly interactive. Refuses to run without a TTY. Creates identity
 * (if needed), project structure, and settings via @clack/prompts.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import * as p from '@clack/prompts';
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { hasKeyFiles, loadIdentityMetadata } from '../core/identity/index.js';
import { getOriginalCwd } from '../core/project.js';
import { performProjectInit, type ProjectInitIdentityInfo } from '../core/project-init.js';
import { isYesMode, sharedArgs } from './_utils.js';
import { EXIT } from './_exit.js';

/**
 * Exit with cancellation message.
 *
 * Clack prompt cancellation happens when user presses Ctrl+C.
 * This helper ensures consistent exit behavior across all prompt flows.
 */
function exitCancelled(): never {

    p.cancel('Cancelled.');
    process.exit(0);

}

/**
 * Prompt user for identity name and email.
 *
 * Returns a ProjectInitIdentityInfo tuple with validated inputs.
 * Exits on user cancellation.
 *
 * @returns Identity info with name and email
 */
async function promptIdentity(): Promise<ProjectInitIdentityInfo> {

    const name = await p.text({
        message: 'Your display name',
        placeholder: 'Alice Smith',
        validate: (value) => (value && value.trim().length > 0 ? undefined : 'Name is required'),
    });

    if (p.isCancel(name)) exitCancelled();

    const email = await p.text({
        message: 'Your email address',
        placeholder: 'alice@example.com',
        validate: (value) => {

            if (!value || value.trim().length === 0) return 'Email is required';
            if (!value.includes('@')) return 'Invalid email';

            return undefined;

        },
    });

    if (p.isCancel(email)) exitCancelled();

    return { name, email };

}

const initCommand = defineCommand({
    meta: { name: 'init', description: 'Bootstrap a new noorm project (interactive)' },
    args: {
        force: sharedArgs.force,
        yes: sharedArgs.yes,
        here: {
            type: 'boolean',
            description: 'Init in the original cwd, ignoring any parent .noorm project',
        },
    },
    async run({ args }) {

        // The CLI entry walks up to find a parent .noorm and chdirs into it.
        // --here opts out: nest a fresh project inside an existing one.
        const projectRoot = args.here ? getOriginalCwd() : process.cwd();
        const noormDir = join(projectRoot, '.noorm');
        const yesMode = isYesMode(args);

        if (existsSync(noormDir) && !args.force) {

            process.stderr.write(
                `Error: noorm project already initialized at ${projectRoot}. Use --force to reinitialize.\n`,
            );
            process.exit(1);

        }

        // === Identity resolution ===
        // Resolve identity first so --yes can decide whether a non-interactive
        // path is viable. Without a full identity, --yes has nothing to fall
        // back on and must error with the bootstrap hint.
        const keysExist = await hasKeyFiles();
        const metadata = await loadIdentityMetadata();
        const hasFullIdentity = keysExist && metadata !== null;

        if (yesMode && !hasFullIdentity) {

            process.stderr.write(
                'Error: noorm init --yes requires an existing identity at ~/.noorm/identity.{key,pub,json}.\n' +
                'Run: noorm identity init --name "Your Name" --email "you@example.com"\n' +
                'Then re-run: noorm init --yes\n',
            );
            process.exit(EXIT.USAGE);

        }

        // TTY gate only fires when --yes can't carry us through. With a full
        // identity and --yes set we have everything needed to bootstrap.
        if (!process.stdin.isTTY && !yesMode) {

            process.stderr.write('Error: noorm init requires an interactive terminal.\n');
            process.exit(EXIT.USAGE);

        }

        p.intro('noorm init');

        let identityInfo: ProjectInitIdentityInfo | null = null;
        if (!hasFullIdentity) {

            identityInfo = await promptIdentity();

        }
        else {

            p.log.info(`Using existing identity: ${metadata!.name} <${metadata!.email}>`);

        }

        // === Bootstrap ===
        const spinner = p.spinner();
        spinner.start('Bootstrapping project');

        const [result, err] = await attempt(() =>
            performProjectInit({ projectRoot, force: !!args.force, identityInfo }),
        );

        if (err) {

            spinner.error('Failed');
            p.log.error(err.message);
            process.exit(1);

        }

        spinner.stop('Done');

        p.outro(
            [
                'noorm initialized.',
                '  Created:',
                ...result!.createdFiles.map((f) => `    ${f}`),
            ].join('\n'),
        );

        process.exit(0);

    },
});

(initCommand as typeof initCommand & { examples: string[] }).examples = [
    'noorm init',
    'noorm init --force',
    'noorm init --here    # nest inside an existing parent project',
    'noorm -c packages/db init    # init packages/db from the repo root',
];

export default initCommand;
