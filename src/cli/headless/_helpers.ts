import type { Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Logger } from '../../core/logger/index.js';
import type { Context } from '../../sdk/context.js';
import type { CryptoIdentity } from '../../core/identity/types.js';
import { createContext } from '../../sdk/index.js';
import { ensureSchemaVersion, type NoormDatabase } from '../../core/version/index.js';
import { loadPrivateKey, loadIdentityMetadata } from '../../core/identity/storage.js';
import { registerIdentity } from '../../core/identity/sync.js';
import { formatHelp } from '../../core/help-formatter.js';
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
            ctx.dialect,
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

/**
 * Create a headless command that outputs help text.
 *
 * Many headless route handlers only display help when invoked
 * without a subcommand. This factory eliminates the repeated pattern.
 *
 * @example
 * ```typescript
 * export const run = createHelpOnlyCommand(help);
 * ```
 */
export function createHelpOnlyCommand(helpText: string): HeadlessCommand {

    return async (_params, flags, _logger) => {

        const output = flags.json ? helpText : formatHelp(helpText);
        process.stdout.write(output + '\n');

        return 0;

    };

}

/**
 * Handles the result/error output for vault headless commands.
 *
 * Replaces the identical 30-line output pattern in vault-set, vault-rm,
 * vault-list, vault-init, and vault-propagate.
 *
 * @example
 * ```typescript
 * return handleVaultResult(result, err, flags, logger, (r) => {
 *     logger.info(`Secret "${key}" set`);
 * });
 * ```
 */
export function handleVaultResult<T extends { success: boolean; error?: string; message?: string }>(
    result: T | null,
    err: Error | null,
    flags: CliFlags,
    logger: Logger,
    onSuccess: (result: T) => void,
): number {

    if (err) {

        if (flags.json) {

            logger.result({ success: false, error: err.message });

        }
        else {

            logger.error(err.message);

        }

        return 1;

    }

    if (flags.json) {

        logger.result(result);

    }
    else {

        if (result?.success) {

            onSuccess(result);

        }
        else {

            logger.error(result?.error ?? result?.message ?? 'Unknown error');

        }

    }

    return result?.success ? 0 : 1;

}

/**
 * Outputs a success result in JSON or text format.
 *
 * Replaces the repeated `if (flags.json) { logger.result(data) } else { logger.info(msg) }` pattern.
 *
 * @example
 * ```typescript
 * outputResult(flags, logger, { released: true }, 'Lock released');
 * outputResult(flags, logger, overview, 'Database Overview', overview);
 * ```
 */
export function outputResult(
    flags: CliFlags,
    logger: Logger,
    json: unknown,
    text: string,
    textData?: Record<string, unknown>,
): void {

    if (flags.json) {

        logger.result(json);

    }
    else {

        logger.info(text, textData);

    }

}

/**
 * Outputs an error in JSON or text format and returns exit code 1.
 *
 * Replaces the repeated `if (flags.json) { logger.result({ success: false, error }) } else { logger.error(msg) }` pattern.
 *
 * @example
 * ```typescript
 * if (!sourceConfig) return outputError(flags, logger, `Config not found: ${name}`);
 * ```
 */
export function outputError(
    flags: CliFlags,
    logger: Logger,
    error: string,
): 1 {

    if (flags.json) {

        logger.result({ success: false, error });

    }
    else {

        logger.error(error);

    }

    return 1;

}

/**
 * Validates required params and shows help if missing.
 *
 * Returns true if all params are present, false if missing
 * (and output has already been written).
 *
 * @example
 * ```typescript
 * if (!requireParams({ key, value }, flags, logger, help)) return 1;
 * ```
 */
export function requireParams(
    params: Record<string, string | undefined>,
    flags: CliFlags,
    logger: Logger,
    helpText: string,
): boolean {

    const missing = Object.entries(params).some(([, v]) => !v);

    if (!missing) return true;

    if (flags.json) {

        logger.result({
            success: false,
            error: `Missing required parameters: ${Object.entries(params).filter(([, v]) => !v).map(([k]) => k).join(', ')}`,
        });

    }
    else {

        const output = formatHelp(helpText);
        process.stdout.write(output + '\n');

    }

    return false;

}
