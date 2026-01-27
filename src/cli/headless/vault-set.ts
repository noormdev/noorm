/**
 * Vault set headless command.
 *
 * Sets a vault secret.
 */
import type { Kysely } from 'kysely';

import { type HeadlessCommand, withVaultContext } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';
import { getVaultKey, setVaultSecret } from '../../core/vault/index.js';
import type { NoormDatabase } from '../../core/shared/index.js';

export const help = `
# VAULT SET

Set a vault secret

## Usage

    noorm vault set <key> <value>

## Arguments

    key      Secret key name (e.g., API_KEY)
    value    Secret value

## Description

Stores an encrypted secret in the vault. Upserts - creates if new, updates if exists.

Requires vault access (run 'noorm vault init' first, or wait for propagation).

## Examples

    noorm vault set API_KEY "sk-live-..."
    noorm vault set DB_PASSWORD "secret123"

## JSON Output

    {
        "success": true,
        "key": "API_KEY",
        "action": "created"
    }
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    const key = params.name;
    const value = params.path; // Using path param for value

    if (!key || !value) {

        if (flags.json) {

            process.stdout.write(JSON.stringify({
                success: false,
                error: 'Usage: noorm vault set <key> <value>',
            }) + '\n');

        }
        else {

            const output = formatHelp(help);
            process.stdout.write(output + '\n');

        }

        return 1;

    }

    const [result, err] = await withVaultContext({
        flags,
        logger,
        fn: async ({ ctx, cryptoIdentity, privateKey }) => {

            const db = ctx.kysely;

            // Get vault key
            const vaultKey = await getVaultKey(db, cryptoIdentity.identityHash, privateKey);

            if (!vaultKey) {

                return {
                    success: false,
                    error: 'No vault access. Run "noorm vault init" or wait for propagation.',
                };

            }

            // Set the secret
            const [, setErr] = await setVaultSecret(
                db,
                vaultKey,
                key,
                value,
                cryptoIdentity.email,
            );

            if (setErr) {

                return { success: false, error: setErr.message };

            }

            return { success: true, key, action: 'set' };

        },
    });

    if (err) {

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: err.message }) + '\n');

        }
        else {

            logger.error(err.message);

        }

        return 1;

    }

    if (flags.json) {

        process.stdout.write(JSON.stringify(result) + '\n');

    }
    else {

        if (result?.success) {

            logger.info(`Vault secret "${key}" set successfully`);

        }
        else {

            logger.error(result?.error ?? 'Unknown error');

        }

    }

    return result?.success ? 0 : 1;

};
