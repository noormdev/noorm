import { describe, it, expect } from 'bun:test';
import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import { DbNamespace } from '../../src/sdk/namespaces/db.js';
import { attempt } from '@logosdx/utils';
import { ProtectedConfigError } from '../../src/sdk/guards.js';
import { PipelinesNamespace } from '../../src/sdk/namespaces/pipelines.js';
import { ChangesNamespace } from '../../src/sdk/namespaces/changes.js';
import { attachPolicyContext } from '../../src/core/policy/index.js';
import { getStateManager } from '../../src/core/state/index.js';

import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';
import type { Settings } from '../../src/core/settings/types.js';

const roles = {
    blind: { permissions: { explore: 'deny' as const } },
    careful: { permissions: { explore: 'confirm' as const } },
    keeper: { permissions: { 'db:teardown': 'deny' as const } },
};

function makeState(role: string, options: ContextState['options'] = {}): ContextState {

    const settings: Settings = { access: { roles } };
    const access = { user: role, agent: role };

    attachPolicyContext(access, { roles });

    const config: Config = {
        name: 'prod',
        type: 'local',
        isTest: false,
        access,
        connection: { dialect: 'postgres', database: 'testdb' },
    };

    const db = new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (inner) => new PostgresIntrospector(inner),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    return {
        connection: { db, dialect: 'postgres' },
        config,
        settings,
        identity: { name: 'tester', source: 'system' },
        options,
        projectRoot: '/tmp/test-project',
        stateManager: getStateManager('/tmp/test-project'),
        changeManager: null,
    };

}

describe('sdk: explore policy', () => {

    it('should refuse every db explore method when the role denies explore', async () => {

        const db = new DbNamespace(makeState('blind', { channel: 'agent' }));

        await expect(db.overview()).rejects.toThrow(/explore/);
        await expect(db.listTables()).rejects.toThrow(/explore/);
        await expect(db.describeTable('users')).rejects.toThrow(/explore/);
        await expect(db.listForeignKeys()).rejects.toThrow(/explore/);

    });

    it('should refuse changes.history when the role denies explore', async () => {

        const changes = new ChangesNamespace(makeState('blind', { channel: 'agent' }));

        await expect(changes.history()).rejects.toThrow(/explore/);
        await expect(changes.historyForChange('x')).rejects.toThrow(/explore/);

    });

    it('should refuse changes.getFileHistory when the role denies explore', async () => {

        const changes = new ChangesNamespace(makeState('blind', { channel: 'agent' }));

        await expect(changes.getFileHistory(1)).rejects.toThrow(/explore/);

    });

    it('should refuse pipelines.history and getRun on the agent channel when the role denies explore', async () => {

        const pipelines = new PipelinesNamespace(makeState('blind', { channel: 'agent' }));

        await expect(pipelines.history('refresh')).rejects.toThrow(/explore/);
        await expect(pipelines.getRun(1)).rejects.toThrow(/explore/);

    });

    it('should pass the pipelines.history explore gate on the user channel', async () => {

        const pipelines = new PipelinesNamespace(makeState('blind'));

        const [, err] = await attempt(() => pipelines.history('refresh'));

        expect(err).not.toBeInstanceOf(ProtectedConfigError);

    });

    it('should refuse previewTeardown when the role denies db:teardown', async () => {

        const db = new DbNamespace(makeState('keeper', { channel: 'agent' }));

        await expect(db.previewTeardown()).rejects.toThrow(/db:teardown/);

    });

    it('should refuse a confirm cell on the agent channel', async () => {

        const db = new DbNamespace(makeState('careful', { channel: 'agent' }));

        await expect(db.listTables()).rejects.toThrow(/requires confirmation from a human/);

    });

    it('should list tables on the user channel whatever the role says about explore', async () => {

        expect(await new DbNamespace(makeState('blind')).listTables()).toEqual([]);
        expect(await new DbNamespace(makeState('careful')).listTables()).toEqual([]);

    });

    it('should leave built-in roles unchanged', async () => {

        const db = new DbNamespace(makeState('viewer'));

        expect(await db.listTables()).toEqual([]);

    });

});
