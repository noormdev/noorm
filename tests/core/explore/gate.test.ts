import { describe, it, expect } from 'bun:test';
import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import { GATED_BY_CALLER, fetchOverview, fetchList, fetchDetail, userGate } from '../../../src/core/explore/index.js';
import type { ExploreGate } from '../../../src/core/explore/index.js';
import { attachPolicyContext, withPolicyConfirmation } from '../../../src/core/policy/index.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const db = new Kysely<unknown>({
    dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (inner) => new PostgresIntrospector(inner),
        createQueryCompiler: () => new PostgresQueryCompiler(),
    },
});

function accessFor(explore: 'allow' | 'deny' | 'confirm'): ConfigAccess {

    const access: ConfigAccess = { user: 'reviewer', agent: 'reviewer' };

    attachPolicyContext(access, { roles: { reviewer: { permissions: { explore } } } });

    return access;

}

function gateFor(explore: 'allow' | 'deny' | 'confirm'): ExploreGate {

    return { configName: 'prod', access: accessFor(explore), channel: 'agent' };

}

describe('explore: policy gate', () => {

    it('should refuse overview, list and detail when the role denies explore', async () => {

        const gate = gateFor('deny');

        await expect(fetchOverview(db, 'postgres', { gate })).rejects.toThrow(/explore/);
        await expect(fetchList(db, 'postgres', 'tables', { gate })).rejects.toThrow(/explore/);
        await expect(fetchDetail(db, 'postgres', 'tables', 'users', { gate })).rejects.toThrow(/explore/);

    });

    it('should list for the user channel whatever the role says about explore', async () => {

        expect(await fetchList(db, 'postgres', 'tables', { gate: userGate({ name: 'prod', access: accessFor('deny') }) })).toEqual([]);
        expect(await fetchList(db, 'postgres', 'tables', { gate: userGate({ name: 'prod', access: accessFor('confirm') }) })).toEqual([]);

    });

    it('should refuse a confirm cell for the agent until it is confirmed, as the row peek does', async () => {

        const gate = gateFor('confirm');

        await expect(fetchList(db, 'postgres', 'tables', { gate })).rejects.toThrow(/requires confirmation/);

        const rows = await withPolicyConfirmation({ name: 'prod', access: gate.access }, ['explore'], () =>
            fetchList(db, 'postgres', 'tables', { gate }),
        );

        expect(rows).toEqual([]);

    });

    it('should list when the role allows explore', async () => {

        expect(await fetchList(db, 'postgres', 'tables', { gate: gateFor('allow') })).toEqual([]);

    });

    it('should skip the check for a caller that was already gated', async () => {

        expect(await fetchList(db, 'postgres', 'tables', { gate: GATED_BY_CALLER })).toEqual([]);

    });

});
