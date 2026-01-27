import type { Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';

import { Logger } from '../../core/logger/index.js';
import type { Context } from '../../sdk/context.js';
import type { CryptoIdentity } from '../../core/identity/types.js';
import { createContext } from '../../sdk/index.js';
import { ensureSchemaVersion, type NoormDatabase } from '../../core/version/index.js';
import { loadPrivateKey, loadIdentityMetadata } from '../../core/identity/storage.js';
import { registerIdentity } from '../../core/identity/sync.js';
import type { RouteParams, CliFlags } from '../types.js';

/**
 * Extended context with crypto identity for vault operations.
 */
export interface VaultContext {
    ctx: Context<NoormDatabase>;
    cryptoIdentity: CryptoIdentity;
    privateKey: string;
}

export interface HeadlessCommand {
    (
        params: RouteParams,
        flags: CliFlags,
        logger: Logger
    ): Promise<number>;
}

export type RouteHandler = {
    run: HeadlessCommand;
    help: string;
    factory?: (...args: unknown[]) => RouteHandler;
}

export const withContext = async <T>(opts: {
    flags: CliFlags;
    logger: Logger;
    fn: (ctx: Context) => Promise<T>;
}): Promise<[T, null] | [null, Error]> => {

    const { flags, logger, fn } = opts;

    const [ctx, ctxError] = await attempt(() => createContext<NoormDatabase>({ config: flags.config }));

    if (ctxError) {

        logger.error('Failed to create context', ctxError);

        return [null, ctxError];

    }

    const [, connectError] = await attempt(() => ctx.connect());

    if (connectError) {

        logger.error('Failed to connect', connectError);

        return [null, connectError];

    }

    // Bootstrap internal tables if they don't exist (for fresh databases in CI)
    const [, schemaError] = await attempt(() =>
        ensureSchemaVersion(
            ctx.kysely as unknown as Kysely<NoormDatabase>,
            ctx.dialect,
        ),
    );

    if (schemaError) {

        logger.error('Failed to initialize database schema', schemaError);
        await attempt(() => ctx.disconnect());

        return [null, schemaError];

    }

    const [result, opError] = await attempt(() => fn(ctx as never));

    // Always disconnect
    await attempt(() => ctx.disconnect());

    if (opError) {

        logger.error(opError.message);

        return [null, opError];

    }

    return [result, null];

};

/**
 * Helper for vault commands that need crypto identity.
 *
 * Extends withContext to also load the crypto identity and private key.
 */
export const withVaultContext = async <T>(opts: {
    flags: CliFlags;
    logger: Logger;
    fn: (vault: VaultContext) => Promise<T>;
}): Promise<[T, null] | [null, Error]> => {

    const { flags, logger, fn } = opts;

    // Load crypto identity
    const [cryptoIdentity, identityErr] = await attempt(() => loadIdentityMetadata());

    if (identityErr || !cryptoIdentity) {

        const msg = 'Identity not set up. Run: noorm identity init';
        logger.error(msg);

        return [null, new Error(msg)];

    }

    // Load private key
    const [privateKey, keyErr] = await attempt(() => loadPrivateKey());

    if (keyErr || !privateKey) {

        const msg = 'Private key not found. Run: noorm identity init';
        logger.error(msg);

        return [null, new Error(msg)];

    }

    // Create context and connect
    const [ctx, ctxError] = await attempt(() => createContext<NoormDatabase>({ config: flags.config }));

    if (ctxError) {

        logger.error('Failed to create context', ctxError);

        return [null, ctxError];

    }

    const [, connectError] = await attempt(() => ctx.connect());

    if (connectError) {

        logger.error('Failed to connect', connectError);

        return [null, connectError];

    }

    // Bootstrap internal tables
    const [, schemaError] = await attempt(() =>
        ensureSchemaVersion(
            ctx.kysely as unknown as Kysely<NoormDatabase>,
            ctx.dialect,
        ),
    );

    if (schemaError) {

        logger.error('Failed to initialize database schema', schemaError);
        await attempt(() => ctx.disconnect());

        return [null, schemaError];

    }

    // Ensure identity is registered in database
    await attempt(() =>
        registerIdentity(
            ctx.kysely as unknown as Kysely<NoormDatabase>,
            cryptoIdentity,
        ),
    );

    const [result, opError] = await attempt(() => fn({
        // Type assertion for generic Context bc it comes from SDK and we allow users to specify DB type
        ctx: ctx as never,
        cryptoIdentity,
        privateKey,
    }));

    // Always disconnect
    await attempt(() => ctx.disconnect());

    if (opError) {

        logger.error(opError.message);

        return [null, opError];

    }

    return [result, null];

};

