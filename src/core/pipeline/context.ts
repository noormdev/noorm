import type { Kysely } from 'kysely';

import type { Config } from '../config/types.js';
import type { Dialect } from '../connection/types.js';
import type { Identity } from '../identity/types.js';
import type { Channel } from '../policy/index.js';
import { buildRunContext } from '../runner/context.js';
import type { NoormDatabase } from '../shared/tables.js';
import type { StateManager } from '../state/index.js';
import { getPackageVersion } from '../state/version.js';
import { prepareTrackingSchema } from '../version/index.js';
import type { PipelineContext } from './types.js';

/** What a caller already holds when it needs a {@link PipelineContext}; the pipeline-only fields are derived from it. */
export interface PipelineContextInput {
    db: Kysely<NoormDatabase>;
    dialect: Dialect;
    config: Config;
    configName: string;
    identity: Identity;
    projectRoot: string;
    stateManager: StateManager;
    pipelinesPath: string;
    channel: Channel;
    yes?: boolean;
    signal?: AbortSignal;
    disposeMemoryConnection?: () => Promise<void>;
    dryRun?: boolean;
}

/** Prepares the tracking tables as the role and `dryRun` allow; an abort during migration rejects before secrets are read. */
export async function buildPipelineContext(input: PipelineContextInput): Promise<PipelineContext> {

    const { db, dialect, config } = input;

    await prepareTrackingSchema(db, dialect, { channel: input.channel, config, dryRun: input.dryRun });
    input.signal?.throwIfAborted();

    const base = await buildRunContext({
        db,
        dialect,
        configName: input.configName,
        identity: input.identity,
        projectRoot: input.projectRoot,
        activeConfig: config,
        stateManager: input.stateManager,
    });

    return {
        ...base,
        dialect,
        connectionConfig: config.connection,
        disposeMemoryConnection: input.disposeMemoryConnection,
        pipelinesPath: input.pipelinesPath,
        cliVersion: getPackageVersion(),
        poolMax: config.connection.pool?.max,
        yes: input.yes,
        signal: input.signal,
        channel: input.channel,
    };

}
