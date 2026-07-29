/**
 * noorm ci identity new — generate a test-CI identity keypair.
 *
 * Local-only: no DB contact, no state written. Prints a copy-pasteable
 * env block the developer stores in their CI secrets. The generated
 * identityHash uses `os: 'env'` + `machine: publicKey` so it matches
 * what `loadIdentityFromEnv` computes when the runner loads the same
 * private key at runtime.
 */
import { attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { generateKeyPair } from '../../../core/identity/crypto.js';
import { computeIdentityHash } from '../../../core/identity/hash.js';
import { outputResult, outputError, sharedArgs } from '../../_utils.js';
import { EXIT } from '../../_exit.js';

const newCommand = defineCommand({
    meta: {
        name: 'new',
        description: 'Generate a test-CI identity keypair (prints env block to stdout)',
    },
    args: {
        name: { type: 'string', description: 'Display name for the identity', required: true },
        email: { type: 'string', description: 'Email address for the identity', required: true },
        json: sharedArgs.json,
    },
    async run({ args }) {

        const name = args.name?.trim();
        const email = args.email?.trim();

        if (!name || !email) {

            outputError(args, 'Both --name and --email are required and must be non-empty.');
            process.exit(EXIT.USAGE);

        }

        const [keyPair, keyErr] = attemptSync(() => generateKeyPair());

        if (keyErr || !keyPair) {

            outputError(args, `Failed to generate keypair: ${keyErr?.message ?? 'unknown error'}`);
            process.exit(1);

        }

        const { privateKey, publicKey } = keyPair;

        const [identityHash, hashErr] = attemptSync(() =>
            computeIdentityHash({
                email,
                name,
                machine: publicKey,
                os: 'env',
            }),
        );

        if (hashErr || !identityHash) {

            outputError(args, `Failed to compute identity hash: ${hashErr?.message ?? 'unknown error'}`);
            process.exit(1);

        }

        const envBlock = {
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: name,
            NOORM_IDENTITY_EMAIL: email,
        };

        const textLines = [
            'New CI identity generated.',
            '',
            `  Name:        ${name}`,
            `  Email:       ${email}`,
            `  Public key:  ${publicKey}`,
            `  Fingerprint: ${identityHash}`,
            '',
            'Copy the following into your CI secrets store (e.g. GitHub Actions secrets):',
            '',
            `  NOORM_IDENTITY_PRIVATE_KEY=${privateKey}`,
            `  NOORM_IDENTITY_NAME=${name}`,
            `  NOORM_IDENTITY_EMAIL=${email}`,
            '',
            'WARNING: the private key will not be shown again. Store it now.',
        ].join('\n');

        outputResult(
            args,
            {
                name,
                email,
                publicKey,
                identityHash,
                privateKey,
                envBlock,
            },
            textLines,
        );

        process.exit(0);

    },
});

(newCommand as typeof newCommand & { examples: string[] }).examples = [
    'noorm ci identity new --name "CI Bot" --email ci@example.com',
    'noorm ci identity new --name "CI Bot" --email ci@example.com --json',
];

export default newCommand;
