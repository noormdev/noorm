import type { Kysely } from 'kysely';

import type { RouteParams, CliFlags } from '../types.js';
import { Logger } from '../../core/logger/index.js';
import type { Context } from '../../sdk/context.js';
import type { NoormDatabase } from '../../core/shared/index.js';
import { attempt } from '@logosdx/utils';
import { createContext } from '../../sdk/index.js';
import { ensureSchemaVersion } from '../../core/version/index.js';

// Version string for schema tracking
const CLI_VERSION = '1.0.0';

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

    const [ctx, ctxError] = await attempt(() => createContext({ config: flags.config }));

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
        ensureSchemaVersion(ctx.kysely as unknown as Kysely<NoormDatabase>, CLI_VERSION),
    );

    if (schemaError) {

        logger.error('Failed to initialize database schema', schemaError);
        await attempt(() => ctx.disconnect());

        return [null, schemaError];

    }

    const [result, opError] = await attempt(() => fn(ctx));

    // Always disconnect
    await attempt(() => ctx.disconnect());

    if (opError) {

        logger.error(opError.message);

        return [null, opError];

    }

    return [result, null];

};

