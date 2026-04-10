/**
 * noorm identity edit — update display name or email on an existing identity.
 *
 * Loads the current identity metadata from ~/.noorm/identity.json,
 * applies only the fields that were explicitly provided, and saves back.
 * At least one of --name or --email must be supplied.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { loadIdentityMetadata, saveIdentityMetadata } from '../../core/identity/storage.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const editCommand = defineCommand({
    meta: { name: 'edit', description: 'Edit identity metadata (name, email)' },
    args: {
        name: { type: 'string', description: 'New display name' },
        email: { type: 'string', description: 'New email address' },
        json: sharedArgs.json,
    },
    async run({ args }) {

        if (!args.name && !args.email) {

            outputError(args, 'At least one of --name or --email must be provided.');
            process.exit(1);

        }

        const [existing, loadErr] = await attempt(() => loadIdentityMetadata());

        if (loadErr) {

            outputError(args, `Failed to load identity: ${loadErr.message}`);
            process.exit(1);

        }

        if (!existing) {

            outputError(args, 'No identity found. Run `noorm identity init` first.');
            process.exit(1);

        }

        const updated = {
            ...existing,
            ...(args.name ? { name: args.name } : {}),
            ...(args.email ? { email: args.email } : {}),
        };

        const [, saveErr] = await attempt(() => saveIdentityMetadata(updated));

        if (saveErr) {

            outputError(args, `Failed to save identity: ${saveErr.message}`);
            process.exit(1);

        }

        outputResult(
            args,
            {
                name: updated.name,
                email: updated.email,
                fingerprint: updated.identityHash,
                publicKey: updated.publicKey,
            },
            `Identity updated.\n  Name:        ${updated.name}\n  Email:       ${updated.email}\n  Fingerprint: ${updated.identityHash}`,
        );
        process.exit(0);

    },
});

(editCommand as typeof editCommand & { examples: string[] }).examples = [
    'noorm identity edit --name "Alice Smith"',
    'noorm identity edit --email alice@example.com',
    'noorm identity edit --name "Alice Smith" --email alice@example.com',
];

export default editCommand;
