/**
 * noorm identity ci — validate env-based identity configuration.
 *
 * This is a diagnostic. The actual env-identity bootstrap happens in
 * cli/index.ts at process startup; this command just calls the same
 * loader and reports the result so CI pipelines can verify that their
 * env vars produce a valid identity before running real work.
 */
import { defineCommand } from 'citty';

import { loadIdentityFromEnv, CI_ENV_VARS } from '../../core/identity/env.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const ciCommand = defineCommand({
    meta: { name: 'ci', description: 'Validate identity from CI environment variables' },
    args: {
        json: sharedArgs.json,
    },
    async run({ args }) {

        const result = loadIdentityFromEnv();

        if (!result) {

            const missing = [
                !process.env[CI_ENV_VARS.privateKey] ? CI_ENV_VARS.privateKey : null,
                !process.env[CI_ENV_VARS.name] ? CI_ENV_VARS.name : null,
                !process.env[CI_ENV_VARS.email] ? CI_ENV_VARS.email : null,
            ].filter(Boolean);

            const msg = missing.length > 0
                ? `Missing or invalid environment variables: ${missing.join(', ')}`
                : `${CI_ENV_VARS.privateKey} is invalid (expected 96 hex characters of a valid X25519 PKCS8 key)`;

            outputError(args, msg);
            process.exit(1);

        }

        outputResult(
            args,
            {
                name: result.identity.name,
                email: result.identity.email,
                publicKey: result.identity.publicKey,
                fingerprint: result.identity.identityHash,
                source: 'env' as const,
            },
            [
                'CI identity loaded.',
                `  Name:        ${result.identity.name}`,
                `  Email:       ${result.identity.email}`,
                `  Public key:  ${result.identity.publicKey}`,
                `  Fingerprint: ${result.identity.identityHash}`,
            ].join('\n'),
        );
        process.exit(0);

    },
});

(ciCommand as typeof ciCommand & { examples: string[] }).examples = [
    'NOORM_IDENTITY_PRIVATE_KEY=<hex> NOORM_IDENTITY_NAME="CI Bot" NOORM_IDENTITY_EMAIL=ci@example.com noorm identity ci',
    'noorm identity ci --json',
];

export default ciCommand;
