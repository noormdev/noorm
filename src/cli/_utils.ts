/**
 * CLI utilities for citty commands.
 *
 * Wraps createContext/Logger lifecycle for headless command execution.
 * Commands receive a plain `args` object from citty and call withContext
 * or withVaultContext to run work against a connected database context.
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { attempt } from '@logosdx/utils';

import type { Context } from '../sdk/context.js';
import type { CryptoIdentity } from '../core/identity/types.js';
import { Logger, type LoggerOptions, type LogLevel } from '../core/logger/index.js';
import { getSettingsManager } from '../core/settings/index.js';
import { getSqlErrorMessage } from '../core/shared/index.js';
import { createContext } from '../sdk/index.js';
import { ensureSchemaVersion, type NoormDatabase } from '../core/version/index.js';
import { loadPrivateKey, loadIdentityMetadata } from '../core/identity/storage.js';
import { registerIdentity } from '../core/identity/sync.js';
import { isDev } from '../core/environment.js';
import { getConfig } from '../core/config/index.js';

/**
 * Minimal args shape expected by the helpers.
 * Commands declare these args natively on their citty defineCommand.
 */
export interface CliArgs {
    config?: string;
    json?: boolean;
    force?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    [key: string]: unknown;
}

/**
 * Shared arg definitions for spreading into citty commands.
 *
 * @example
 * ```ts
 * args: { ...sharedArgs, customArg: { ... } }
 * ```
 */
export const sharedArgs = {
    config: { type: 'string', alias: 'c', description: 'Use specific configuration' },
    json: { type: 'boolean', description: 'Output JSON' },
    force: { type: 'boolean', alias: 'f', description: 'Force operation' },
    dryRun: { type: 'boolean', description: 'Preview without executing' },
    yes: { type: 'boolean', alias: 'y', description: 'Skip confirmations' },
} as const;

/**
 * Extended context with crypto identity for vault operations.
 */
export interface VaultContext {
    ctx: Context<NoormDatabase>;
    cryptoIdentity: CryptoIdentity;
    privateKey: string;
}

/**
 * Create a Logger configured for CLI execution.
 *
 * The Logger subscribes to observer events so core module progress
 * reaches stdout automatically. Commands only need to call logger.info
 * or logger.result for explicit output not tied to events.
 */
async function createCliLogger(projectRoot: string, json: boolean): Promise<Logger> {

    const settingsManager = getSettingsManager(projectRoot);
    const [, settingsErr] = await attempt(() => settingsManager.load());
    const settings = settingsErr ? {} : settingsManager.settings;

    const logPath = join(projectRoot, '.noorm', 'state', 'noorm.log');
    const [, mkdirErr] = await attempt(() => mkdir(dirname(logPath), { recursive: true }));

    let fileStream: ReturnType<typeof createWriteStream> | undefined;
    if (!mkdirErr) {

        fileStream = createWriteStream(logPath, { flags: 'a' });
        fileStream.on('error', () => {}); // best-effort file logging

    }

    let defaultLevel: LogLevel = 'info';
    if (isDev()) {

        defaultLevel = 'verbose';

    }

    const options: LoggerOptions = {
        projectRoot,
        settings,
        config: {
            enabled: true,
            level: getConfig('log.level', defaultLevel)!,
        },
        console: process.stdout,
        file: fileStream ?? undefined,
        json,
        color: !json,
    };

    return new Logger(options);

}

/**
 * Run a function against a connected SDK context.
 *
 * Handles context creation, connection, schema bootstrap, Logger lifecycle,
 * and cleanup. Returns [result, null] on success or [null, error] on failure.
 * Errors are written to output before the tuple is returned.
 *
 * @example
 * ```ts
 * const [result, err] = await withContext({
 *     args,
 *     fn: (ctx) => ctx.noorm.changes.ff(),
 * });
 * if (err) process.exit(1);
 * ```
 */
export async function withContext<T>(opts: {
    args: CliArgs;
    fn: (ctx: Context<NoormDatabase>, logger: Logger) => Promise<T>;
}): Promise<[T, null] | [null, Error]> {

    const { args, fn } = opts;
    const projectRoot = process.cwd();
    const logger = await createCliLogger(projectRoot, !!args.json);
    await logger.start();

    const [ctx, ctxError] = await attempt(() => createContext<NoormDatabase>({ config: args.config }));
    if (ctxError) {

        outputError(args, `Failed to create context: ${ctxError.message}`, logger);
        await logger.stop();

        return [null, ctxError];

    }

    const [, connectError] = await attempt(() => ctx.connect());
    if (connectError) {

        outputError(args, `Failed to connect: ${connectError.message}`, logger);
        await logger.stop();

        return [null, connectError];

    }

    const [, schemaError] = await attempt(() =>
        ensureSchemaVersion(
            ctx.kysely,
            ctx.dialect,
        ),
    );
    if (schemaError) {

        outputError(args, `Failed to initialize database schema: ${schemaError.message}`, logger);
        await attempt(() => ctx.disconnect());
        await logger.stop();

        return [null, schemaError];

    }

    const [result, opError] = await attempt(() => fn(ctx, logger));

    await attempt(() => ctx.disconnect());

    if (opError) {

        outputError(args, getSqlErrorMessage(opError), logger);
        await logger.stop();

        return [null, opError];

    }

    await logger.stop();

    return [result, null];

}

/**
 * Same as withContext but also loads the crypto identity and private key
 * for vault operations.
 */
export async function withVaultContext<T>(opts: {
    args: CliArgs;
    fn: (vault: VaultContext, logger: Logger) => Promise<T>;
}): Promise<[T, null] | [null, Error]> {

    const { args, fn } = opts;
    const projectRoot = process.cwd();
    const logger = await createCliLogger(projectRoot, !!args.json);
    await logger.start();

    const [cryptoIdentity, identityErr] = await attempt(() => loadIdentityMetadata());
    if (identityErr || !cryptoIdentity) {

        const msg = 'Identity not set up. Run: noorm identity init';
        outputError(args, msg, logger);
        await logger.stop();

        return [null, new Error(msg)];

    }

    const [privateKey, keyErr] = await attempt(() => loadPrivateKey());
    if (keyErr || !privateKey) {

        const msg = 'Private key not found. Run: noorm identity init';
        outputError(args, msg, logger);
        await logger.stop();

        return [null, new Error(msg)];

    }

    const [ctx, ctxError] = await attempt(() => createContext<NoormDatabase>({ config: args.config }));
    if (ctxError) {

        outputError(args, `Failed to create context: ${ctxError.message}`, logger);
        await logger.stop();

        return [null, ctxError];

    }

    const [, connectError] = await attempt(() => ctx.connect());
    if (connectError) {

        outputError(args, `Failed to connect: ${connectError.message}`, logger);
        await logger.stop();

        return [null, connectError];

    }

    const [, schemaError] = await attempt(() =>
        ensureSchemaVersion(
            ctx.kysely,
            ctx.dialect,
        ),
    );
    if (schemaError) {

        outputError(args, `Failed to initialize database schema: ${schemaError.message}`, logger);
        await attempt(() => ctx.disconnect());
        await logger.stop();

        return [null, schemaError];

    }

    await attempt(() =>
        registerIdentity(
            ctx.kysely,
            cryptoIdentity,
            ctx.dialect,
        ),
    );

    const [result, opError] = await attempt(() => fn({
        ctx,
        cryptoIdentity,
        privateKey,
    }, logger));

    await attempt(() => ctx.disconnect());

    if (opError) {

        outputError(args, getSqlErrorMessage(opError), logger);
        await logger.stop();

        return [null, opError];

    }

    await logger.stop();

    return [result, null];

}

/**
 * Output a success result as either JSON or text.
 *
 * When logger is provided and args.json is false, the text message is
 * routed through logger.info so it appears in the same stream as event
 * output. Otherwise it writes directly to stdout.
 */
export function outputResult(
    args: CliArgs,
    json: unknown,
    text: string,
    logger?: Logger,
): void {

    if (args.json) {

        if (logger) {

            logger.result(json);

        }
        else {

            process.stdout.write(JSON.stringify(json) + '\n');

        }

    }
    else {

        if (logger) {

            logger.info(text);

        }
        else {

            process.stdout.write(text + '\n');

        }

    }

}

/**
 * Output an error as either JSON or text.
 */
export function outputError(args: CliArgs, error: string, logger?: Logger): void {

    if (args.json) {

        if (logger) {

            logger.result({ success: false, error });

        }
        else {

            process.stdout.write(JSON.stringify({ success: false, error }) + '\n');

        }

    }
    else {

        if (logger) {

            logger.error(error);

        }
        else {

            process.stderr.write('Error: ' + error + '\n');

        }

    }

}

/**
 * Helper for vault commands: standardizes success/error output
 * based on the { success, error?, message? } shape returned by
 * most vault operations.
 */
export function handleVaultResult<T extends { success: boolean; error?: string; message?: string }>(
    result: T | null,
    err: Error | null,
    args: CliArgs,
    logger: Logger,
    onSuccess: (result: T) => void,
): number {

    if (err) {

        outputError(args, err.message, logger);

        return 1;

    }

    if (args.json) {

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
