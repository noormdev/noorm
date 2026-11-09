import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { DummyDriver, Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from 'kysely';

import type { Config } from '../../../src/core/config/types.js';
import { buildPipelineContext } from '../../../src/core/pipeline/context.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';
import { StateManager } from '../../../src/core/state/index.js';
import * as vault from '../../../src/core/vault/index.js';
import * as version from '../../../src/core/version/index.js';

const config: Config = {
    name: 'test', type: 'local', isTest: true, access: { user: 'admin', agent: 'admin' },
    connection: { dialect: 'sqlite', database: ':memory:' },
};

afterEach(() => {

    mock.restore();

});

describe('pipeline: buildPipelineContext', () => {

    it('should skip the vault and secret lookups when the run is aborted during migration', async () => {

        const controller = new AbortController();
        const db = new Kysely<NoormDatabase>({
            dialect: {
                createAdapter: () => new SqliteAdapter(),
                createDriver: () => new DummyDriver(),
                createIntrospector: (kysely) => new SqliteIntrospector(kysely),
                createQueryCompiler: () => new SqliteQueryCompiler(),
            },
        });
        spyOn(version, 'ensureSchemaVersion').mockImplementation(async () => {

            controller.abort();

        });
        const resolveVaultKey = spyOn(vault, 'resolveVaultKey').mockResolvedValue(null);
        const buildSecretsContext = spyOn(vault, 'buildSecretsContext').mockResolvedValue({});

        const [context, err] = await attempt(() => buildPipelineContext({
            db, dialect: 'sqlite', config, configName: 'test',
            identity: { name: 'Test', source: 'config' }, projectRoot: '/tmp/noorm-pipeline-context',
            stateManager: new StateManager('/tmp/noorm-pipeline-context'),
            pipelinesPath: 'pipelines', channel: 'user', signal: controller.signal,
        }));

        expect(err).toMatchObject({ name: 'AbortError' });
        expect(context).toBeNull();
        expect(resolveVaultKey).not.toHaveBeenCalled();
        expect(buildSecretsContext).not.toHaveBeenCalled();

    });

});
