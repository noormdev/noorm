/**
 * noorm ci identity enroll — register a CI identity in a prod DB and
 * propagate vault access to it.
 *
 * Run once by a developer who already has vault access. Either mints a
 * new keypair or accepts a pre-generated public key (air-gapped flow).
 * Inserts the identity row (idempotent on identityHash) and propagates
 * the vault key so the new identity can decrypt secrets at runtime.
 *
 * identityHash uses `os: 'env'` + `machine: publicKey` so it matches
 * what `loadIdentityFromEnv` computes when the runner reads the same
 * private key from env at CI runtime.
 *
 * The grant is gated on `vault:propagate` against the target config's
 * `access`, so a `viewer` config cannot enroll at all and every role that can
 * must pass `--yes` — sealing the vault key to a public key is irreversible.
 */
import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { generateKeyPair } from '../../../core/identity/crypto.js';
import { computeIdentityHash } from '../../../core/identity/hash.js';
import { isValidKeyHex } from '../../../core/identity/storage.js';
import { resolveChannel } from '../../../core/policy/index.js';
import { propagateVaultKeyToChecked, checkVaultPolicy } from '../../../core/vault/index.js';
import type { VaultPolicyGate } from '../../../core/vault/index.js';
import { decryptVaultKey } from '../../../core/vault/key.js';
import { getNoormTables, noormDb } from '../../../core/shared/tables.js';
import type { NoormDatabase } from '../../../core/shared/tables.js';
import type { EncryptedVaultKey } from '../../../core/vault/types.js';
import { outputResult, outputError, sharedArgs, isYesMode, withVaultContext } from '../../_utils.js';
import { EXIT } from '../../_exit.js';

const enrollCommand = defineCommand({
    meta: {
        name: 'enroll',
        description: 'Register a CI identity in the target DB and grant vault access',
    },
    args: {
        config: { ...sharedArgs.config, required: true },
        name: {
            type: 'string',
            description: 'Display name for the CI identity',
            required: true,
        },
        email: {
            type: 'string',
            description: 'Email address for the CI identity',
            required: true,
        },
        publicKey: {
            type: 'string',
            description: 'Pre-generated X25519 public key (hex). If omitted, a new keypair is generated.',
        },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const name = args.name?.trim();
        const email = args.email?.trim();
        const providedPublicKey = args.publicKey?.trim();

        if (!name || !email || !args.config) {

            outputError(args, 'Missing required: --config, --name, --email');
            process.exit(EXIT.USAGE);

        }

        const [result, err] = await withVaultContext({
            args,
            fn: async ({ ctx, cryptoIdentity, privateKey }) => {

                // Enrollment ends in a vault grant, so it is a config-scoped
                // action gated on `vault:propagate` like every other vault
                // operation. Checked before any read or write: a role denied
                // the vault should not get to probe the identities table.
                const enrollConfig = ctx.noorm.config;
                const gate: VaultPolicyGate = {
                    configName: enrollConfig.name,
                    access: enrollConfig.access,
                    channel: resolveChannel(),
                };

                const policy = checkVaultPolicy(gate, 'vault:propagate');

                if (!policy.allowed) {

                    throw new Error(
                        policy.blockedReason
                        ?? `Config "${enrollConfig.name}" cannot grant vault access.`,
                    );

                }

                let newPublicKey: string;
                let newPrivateKey: string | null = null;

                if (providedPublicKey) {

                    // Validated before any write. An unchecked key used to be
                    // INSERTed and only fail later at propagation, leaving a row
                    // no retry could repair: the retry short-circuits on the
                    // existing hash and registerIdentity never updates public_key.
                    if (!isValidKeyHex(providedPublicKey)) {

                        throw new Error(
                            'Invalid --public-key: expected a hex-encoded X25519 public key ' +
                            '(88 hex characters, as printed by `noorm ci identity new`).',
                        );

                    }

                    newPublicKey = providedPublicKey;

                }
                else {

                    const kp = generateKeyPair();
                    newPublicKey = kp.publicKey;
                    newPrivateKey = kp.privateKey;

                }

                const identityHash = computeIdentityHash({
                    email,
                    name,
                    machine: newPublicKey,
                    os: 'env',
                });

                const tables = getNoormTables(ctx.dialect);
                const ndb = noormDb(ctx.kysely, ctx.dialect);

                const [callerRow, callerErr] = await attempt(() =>
                    ndb
                        .selectFrom(tables.identities as keyof NoormDatabase)
                        .select(['encrypted_vault_key'])
                        .where('identity_hash', '=', cryptoIdentity.identityHash)
                        .executeTakeFirst(),
                );

                if (callerErr) {

                    throw new Error(`Failed to read caller identity: ${callerErr.message}`);

                }

                if (!callerRow?.encrypted_vault_key) {

                    throw new Error(
                        'You do not have vault access on this config. ' +
                        'Ask an existing vault member to propagate access to your identity first.',
                    );

                }

                const [parsedKey, parseErr] = attemptSync(
                    () => JSON.parse(callerRow.encrypted_vault_key as string) as EncryptedVaultKey,
                );

                if (parseErr || !parsedKey) {

                    throw new Error(`Failed to parse caller's encrypted vault key: ${parseErr?.message ?? 'unknown'}`);

                }

                const vaultKey = decryptVaultKey(parsedKey, privateKey);

                if (!vaultKey) {

                    throw new Error('Failed to decrypt vault key with your private key.');

                }

                const [existing, existingErr] = await attempt(() =>
                    ndb
                        .selectFrom(tables.identities as keyof NoormDatabase)
                        .select(['identity_hash', 'public_key', 'encrypted_vault_key'])
                        .where('identity_hash', '=', identityHash)
                        .executeTakeFirst(),
                );

                if (existingErr) {

                    throw new Error(`Failed to check for existing identity: ${existingErr.message}`);

                }

                let alreadyEnrolled = false;

                if (existing) {

                    // The hash's only secret input is the public key, which the
                    // air-gapped flow tells you to circulate in the clear. Anyone
                    // able to INSERT into the identities table — no vault access
                    // needed — can therefore pre-register this hash carrying their
                    // own key, and propagation below encrypts the vault key to
                    // whatever the ROW holds, not to what was presented here.
                    // Matching on hash alone is what made that a vault-theft
                    // primitive; the presented key must match the stored one.
                    if (existing.public_key !== newPublicKey) {

                        throw new Error(
                            `Refusing to enroll: an identity is already registered under this hash (${identityHash}) ` +
                            'with a DIFFERENT public key. Enrolling would grant vault access to that key, not the one ' +
                            'you supplied. This is what a pre-registration attack looks like — verify who created that ' +
                            'row before removing it, and rotate the vault if you cannot account for it.',
                        );

                    }

                    alreadyEnrolled = true;

                }
                else {

                    const [, insertErr] = await attempt(() =>
                        ndb
                            .insertInto(tables.identities as keyof NoormDatabase)
                            .values({
                                identity_hash: identityHash,
                                email,
                                name,
                                machine: 'ci',
                                os: 'env',
                                public_key: newPublicKey,
                                encrypted_vault_key: null,
                            } as never)
                            .execute(),
                    );

                    if (insertErr) {

                        throw new Error(`Failed to insert identity row: ${insertErr.message}`);

                    }

                }

                // Sealing the vault key to a public key cannot be undone, so
                // `vault:propagate` is a `confirm` cell for every role that
                // holds it. Asked here rather than up front so the operator is
                // shown the identity they are about to grant to — and skipped
                // when the target already holds access, since then confirming
                // would be a prompt for a no-op.
                const alreadyHasVaultAccess = !!existing?.encrypted_vault_key;

                if (policy.requiresConfirmation && !alreadyHasVaultAccess && !isYesMode(args)) {

                    throw new Error(
                        `About to grant irrevocable vault access on config "${enrollConfig.name}" to:\n`
                        + `    Name:        ${name}\n`
                        + `    Email:       ${email}\n`
                        + `    Public key:  ${newPublicKey}\n`
                        + `    Fingerprint: ${identityHash}\n`
                        + 'Verify this is the identity you intend, then re-run with --yes to grant.',
                    );

                }

                const propagated = await propagateVaultKeyToChecked(
                    gate,
                    ctx.kysely,
                    vaultKey,
                    identityHash,
                    ctx.dialect,
                );

                if (!propagated) {

                    throw new Error(
                        `Identity row for ${identityHash} is registered, but propagating the vault key to it failed. ` +
                        'Re-running is safe and will retry the propagation; the identity row is not written twice. ' +
                        'If it keeps failing, check that the row\'s public_key is the one you expect.',
                    );

                }

                return {
                    identityHash,
                    publicKey: newPublicKey,
                    privateKey: newPrivateKey,
                    alreadyEnrolled,
                };

            },
        });

        if (err || !result) {

            process.exit(1);

        }

        const { identityHash, publicKey, privateKey: mintedPrivateKey, alreadyEnrolled } = result;
        const hasPrivateKey = mintedPrivateKey !== null;

        const json: Record<string, unknown> = {
            success: true,
            name,
            email,
            publicKey,
            identityHash,
            enrolledIn: args.config,
            alreadyEnrolled,
        };

        if (hasPrivateKey) {

            json['privateKey'] = mintedPrivateKey;
            json['envBlock'] = {
                NOORM_IDENTITY_PRIVATE_KEY: mintedPrivateKey,
                NOORM_IDENTITY_NAME: name,
                NOORM_IDENTITY_EMAIL: email,
            };

        }

        const headerLine = alreadyEnrolled
            ? `Identity already enrolled in config "${args.config}"; vault access ensured.`
            : `Enrolled new CI identity in config "${args.config}".`;

        const textLines: string[] = [
            headerLine,
            '',
            `  Name:        ${name}`,
            `  Email:       ${email}`,
            `  Public key:  ${publicKey}`,
            `  Fingerprint: ${identityHash}`,
        ];

        if (hasPrivateKey) {

            textLines.push(
                '',
                'Copy the following into your CI secrets store (e.g. GitHub Actions secrets):',
                '',
                `  NOORM_IDENTITY_PRIVATE_KEY=${mintedPrivateKey}`,
                `  NOORM_IDENTITY_NAME=${name}`,
                `  NOORM_IDENTITY_EMAIL=${email}`,
                '',
                'WARNING: the private key will not be shown again. Store it now.',
            );

        }
        else {

            textLines.push('', 'Public key enrolled. The caller already holds the private key.');

        }

        outputResult(args, json, textLines.join('\n'));

        process.exit(0);

    },
});

(enrollCommand as typeof enrollCommand & { examples: string[] }).examples = [
    'noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com',
    'noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com --yes',
    'noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com --public-key <hex> --yes',
    'noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com --json --yes',
];

export default enrollCommand;
