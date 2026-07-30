/**
 * noorm identity edit — update display name or email on an existing identity.
 *
 * Loads the current identity metadata from ~/.noorm/identity.json,
 * applies only the fields that were explicitly provided, and saves back.
 * At least one of --name or --email must be supplied.
 *
 * Goes through `createIdentityForExistingKeys` rather than writing the merged
 * record directly, because the identity hash encodes email|name|machine|os.
 * Spreading new values over the old record left a hash that still meant the
 * previous person — the value the database joins on and grants vault access
 * against — while `identity list` displayed the new one. The TUI's edit screen
 * has always recomputed it; this is the surface that did not.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { createIdentityForExistingKeys } from '../../core/identity/factory.js';
import { loadIdentityMetadata } from '../../core/identity/storage.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

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
            process.exit(EXIT.USAGE);

        }

        const [existing, loadErr] = await attempt(() => loadIdentityMetadata());

        if (loadErr) {

            outputError(args, `Failed to load identity: ${loadErr.message}`);
            process.exit(1);

        }

        if (!existing) {

            outputError(args, 'No identity found. Run `noorm identity init` first.');
            process.exit(EXIT.USAGE);

        }

        // machine is carried over rather than re-detected so the only hash
        // inputs that move are the ones the user actually asked to change.
        const [updated, saveErr] = await attempt(() =>
            createIdentityForExistingKeys({
                name: args.name || existing.name,
                email: args.email || existing.email,
                machine: existing.machine,
            }),
        );

        if (saveErr || !updated) {

            outputError(args, `Failed to save identity: ${saveErr?.message ?? 'identity keys not found'}`);
            process.exit(1);

        }

        const hashChanged = updated.identityHash !== existing.identityHash;

        const textLines = [
            'Identity updated.',
            `  Name:        ${updated.name}`,
            `  Email:       ${updated.email}`,
            `  Fingerprint: ${updated.identityHash}`,
        ];

        if (hashChanged) {

            textLines.push(
                '',
                'NOTE: the fingerprint changed, because it is derived from your name and email.',
                'Vault access is granted against the old fingerprint, so you will need a team',
                'member with vault access to propagate it to the new one.',
                `  Previous: ${existing.identityHash}`,
            );

        }

        outputResult(
            args,
            {
                name: updated.name,
                email: updated.email,
                fingerprint: updated.identityHash,
                publicKey: updated.publicKey,
                previousFingerprint: existing.identityHash,
                fingerprintChanged: hashChanged,
            },
            textLines.join('\n'),
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
