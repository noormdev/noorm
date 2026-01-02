import type { RouteParams, CliFlags } from '../types.js';
import { Logger } from '../../core/logger/index.js';
import type { Context } from '../../sdk/context.js';
import { attempt } from '@logosdx/utils';
import { createContext } from '../../sdk/index.js';

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


    const [result, opError] = await attempt(() => fn(ctx));

    // Always disconnect
    await attempt(() => ctx.disconnect());

    if (opError) {

        logger.error(opError.message);

        return [null, opError];

    }

    return [result, null];

};

