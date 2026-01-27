/**
 * Vault cp headless command.
 *
 * Copies vault secrets between configs.
 */
import { attempt } from '@logosdx/utils';

import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';
import { copyVaultSecrets } from '../../core/vault/index.js';
import { loadPrivateKey, loadIdentityMetadata } from '../../core/identity/storage.js';
import { getStateManager } from '../../core/state/index.js';

export const help = `
# VAULT CP

Copy vault secrets between configs

## Usage

    noorm vault cp [--all] [--force] <key> <source> <destination>
    noorm vault cp --all [--force] <source> <destination>

## Arguments

    key            Secret key to copy (omit with --all)
    source         Source config name
    destination    Destination config name

## Flags

    --all          Copy all secrets
    --force        Overwrite existing secrets in destination
    --dry-run      Preview without executing

## Description

Copies secrets from one vault to another. Requires vault access on both
source and destination. If destination vault is not initialized, it will
be initialized automatically.

## Examples

    noorm vault cp API_KEY staging production
    noorm vault cp --all staging production
    noorm vault cp --all --force staging production
    noorm vault cp --all --dry-run staging production

## JSON Output

    {
        "success": true,
        "copied": ["API_KEY", "DB_PASSWORD"],
        "skipped": ["EXISTING_KEY"],
        "errors": []
    }
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

            process.stdout.write(JSON.stringify({
                success: false,
                error: 'Usage: noorm vault cp [--all] <key> <source> <destination>',
            }) + '\n');

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

        const msg = 'Identity not set up. Run: noorm identity init';

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: msg }) + '\n');

        }
        else {

            logger.error(msg);

        }

        return 1;

    }

    // Load private key
    const [privateKey, keyErr] = await attempt(() => loadPrivateKey());

    if (keyErr || !privateKey) {

        const msg = 'Private key not found. Run: noorm identity init';

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: msg }) + '\n');

        }
        else {

            logger.error(msg);

        }

        return 1;

    }

    // Load state to get configs
    const stateManager = getStateManager(process.cwd());
    const [, loadErr] = await attempt(() => stateManager.load());

    if (loadErr) {

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: loadErr.message }) + '\n');

        }
        else {

            logger.error(loadErr.message);

        }

        return 1;

    }

    const sourceConfig = stateManager.getConfig(sourceConfigName);
    const destConfig = stateManager.getConfig(destConfigName);

    if (!sourceConfig) {

        const msg = `Source config not found: ${sourceConfigName}`;

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: msg }) + '\n');

        }
        else {

            logger.error(msg);

        }

        return 1;

    }

    if (!destConfig) {

        const msg = `Destination config not found: ${destConfigName}`;

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: msg }) + '\n');

        }
        else {

            logger.error(msg);

        }

        return 1;

    }

    if (flags.dryRun) {

        if (flags.json) {

            process.stdout.write(JSON.stringify({
                success: true,
                dryRun: true,
                source: sourceConfigName,
                destination: destConfigName,
                keys: keys === 'all' ? 'all' : keys,
                force: flags.force,
            }) + '\n');

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

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: copyErr.message }) + '\n');

        }
        else {

            logger.error(copyErr.message);

        }

        return 1;

    }

    if (flags.json) {

        process.stdout.write(JSON.stringify({
            success: true,
            copied: result?.copied ?? [],
            skipped: result?.skipped ?? [],
            errors: result?.errors ?? [],
        }) + '\n');

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
