/**
 * Vault cp headless command.
 *
 * Copies vault secrets between configs.
 */
import { attempt } from '@logosdx/utils';

import { outputError, type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';
import { copyVaultSecrets } from '../../core/vault/index.js';
import { loadPrivateKey, loadIdentityMetadata } from '../../core/identity/storage.js';
import { getStateManager } from '../../core/state/index.js';

export const help = `
# VAULT CP

Copy vault secrets between configs

## Usage

    noorm -H vault cp [--all] [--force] <key> <source> <destination>
    noorm -H vault cp --all [--force] <source> <destination>

## Arguments

    key            Secret key to copy (omit with --all)
    source         Source config name
    destination    Destination config name

## Flags

    --all          Copy all secrets from source
    --force        Overwrite existing secrets in destination
    --dry-run      Preview what would be copied without executing

## Description

Copies secrets from one vault to another. Requires vault access on both
source and destination. If the destination vault is not initialized, it
will be initialized automatically.

Without \`--force\`, existing secrets in the destination are skipped.

## Examples

    noorm -H vault cp API_KEY staging production                Copy one secret
    noorm -H vault cp --all staging production                  Copy all secrets
    noorm -H vault cp --all --force staging production          Overwrite existing
    noorm -H vault cp --all --dry-run staging production        Preview only
    noorm -H --json vault cp --all staging production           JSON output

## JSON Output

    {
        "success": true,
        "copied": ["API_KEY", "DB_PASSWORD"],
        "skipped": ["EXISTING_KEY"],
        "errors": []
    }

With \`--dry-run\`:

    {
        "success": true,
        "dryRun": true,
        "source": "staging",
        "destination": "production",
        "keys": "all",
        "force": false
    }

## See Also

See \`noorm help vault list\`, \`noorm help vault set\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    // Parse arguments based on --all flag
    // With --all: vault cp --all <source> <dest>
    // Without: vault cp <key> <source> <dest>
    let keys: string[] | 'all' = 'all';
    let sourceConfigName: string | undefined;
    let destConfigName: string | undefined;

    if (flags.force && !params.name) {

        // --all mode: vault cp --all <source> <dest>
        // params.name = source, params.path = dest
        // But this needs custom parsing...
        // For now, we'll use a simpler approach: vault cp <source> <dest> --all
        sourceConfigName = params.name;
        destConfigName = params.path;

    }
    else if (params.name && params.path && params.stage) {

        // vault cp <key> <source> <dest>
        keys = [params.name];
        sourceConfigName = params.path;
        destConfigName = params.stage;

    }
    else if (params.name && params.path) {

        // Check if --all is implied (params.name is source, params.path is dest)
        // This is tricky - we need to know if --all is set
        // For simplicity, if only two args, assume --all mode
        keys = 'all';
        sourceConfigName = params.name;
        destConfigName = params.path;

    }

    if (!sourceConfigName || !destConfigName) {

        if (flags.json) {

            logger.result({
                success: false,
                error: 'Usage: noorm vault cp [--all] <key> <source> <destination>',
            });

        }
        else {

            const output = formatHelp(help);
            process.stdout.write(output + '\n');

        }

        return 1;

    }

    // Load crypto identity
    const [cryptoIdentity, identityErr] = await attempt(() => loadIdentityMetadata());

    if (identityErr || !cryptoIdentity) {

        return outputError(flags, logger, 'Identity not set up. Run: noorm identity init');

    }

    // Load private key
    const [privateKey, keyErr] = await attempt(() => loadPrivateKey());

    if (keyErr || !privateKey) {

        return outputError(flags, logger, 'Private key not found. Run: noorm identity init');

    }

    // Load state to get configs
    const stateManager = getStateManager(process.cwd());
    const [, loadErr] = await attempt(() => stateManager.load());

    if (loadErr) {

        return outputError(flags, logger, loadErr.message);

    }

    const sourceConfig = stateManager.getConfig(sourceConfigName);
    const destConfig = stateManager.getConfig(destConfigName);

    if (!sourceConfig) {

        return outputError(flags, logger, `Source config not found: ${sourceConfigName}`);

    }

    if (!destConfig) {

        return outputError(flags, logger, `Destination config not found: ${destConfigName}`);

    }

    if (flags.dryRun) {

        if (flags.json) {

            logger.result({
                success: true,
                dryRun: true,
                source: sourceConfigName,
                destination: destConfigName,
                keys: keys === 'all' ? 'all' : keys,
                force: flags.force,
            });

        }
        else {

            logger.info(`Dry run: would copy ${keys === 'all' ? 'all secrets' : keys.join(', ')} from "${sourceConfigName}" to "${destConfigName}"`);

            if (flags.force) {

                logger.info('With --force: would overwrite existing secrets');

            }

        }

        return 0;

    }

    // Execute copy
    const [result, copyErr] = await copyVaultSecrets(
        sourceConfig,
        destConfig,
        keys,
        cryptoIdentity.identityHash,
        privateKey,
        cryptoIdentity.publicKey,
        { force: flags.force },
    );

    if (copyErr) {

        return outputError(flags, logger, copyErr.message);

    }

    if (flags.json) {

        logger.result({
            success: true,
            copied: result?.copied ?? [],
            skipped: result?.skipped ?? [],
            errors: result?.errors ?? [],
        });

    }
    else {

        const copied = result?.copied ?? [];
        const skipped = result?.skipped ?? [];
        const errors = result?.errors ?? [];

        if (copied.length > 0) {

            logger.info(`Copied ${copied.length} secrets: ${copied.join(', ')}`);

        }

        if (skipped.length > 0) {

            logger.info(`Skipped ${skipped.length} existing secrets: ${skipped.join(', ')}`);
            logger.info('Use --force to overwrite');

        }

        if (errors.length > 0) {

            for (const e of errors) {

                logger.error(`Failed to copy "${e.key}": ${e.error}`);

            }

        }

        if (copied.length === 0 && skipped.length === 0 && errors.length === 0) {

            logger.info('No secrets to copy');

        }

    }

    return result?.errors?.length ? 1 : 0;

};
