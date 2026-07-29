/**
 * transferData policy-gate unit tests.
 *
 * Proves transferData gates on the DESTINATION config's access role (not
 * the source) before any connection is attempted — no container required
 * since a deny returns before withDualConnection ever opens a socket.
 */
import { describe, it, expect } from 'bun:test';

import { transferData, getTransferPlan } from '../../../src/core/transfer/index.js';
import { makeTestConfig } from '../../utils/db.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const VIEWER: ConfigAccess = { user: 'viewer', mcp: false };
const ADMIN: ConfigAccess = { user: 'admin', mcp: 'admin' };

describe('transfer: policy gate', () => {

    it('should deny transferData when the destination role denies db:reset', async () => {

        const source = { ...makeTestConfig('source', { dialect: 'postgres', database: 'x' }), access: ADMIN };
        const dest = { ...makeTestConfig('dest', { dialect: 'postgres', database: 'y' }), access: VIEWER };

        const [result, err] = await transferData(source, dest, { channel: 'user' });

        expect(result).toBeNull();
        expect(err?.message).toMatch(/db:reset/);
        expect(err?.message).toContain('dest');

    });

    it('should gate on the destination, not the source', async () => {

        // Source is viewer (would deny if the gate looked at it), dest is
        // admin — the gate must pass, so the failure (if any) surfaces from
        // dialect validation, not the policy layer.
        const source = { ...makeTestConfig('source', { dialect: 'postgres', database: 'x' }), access: VIEWER };
        const dest = { ...makeTestConfig('dest', { dialect: 'sqlite', database: 'y' }), access: ADMIN };

        const [result, err] = await transferData(source, dest, { channel: 'user' });

        expect(result).toBeNull();
        expect(err?.message).not.toMatch(/db:reset.*not allowed/);
        expect(err?.message).toMatch(/not supported/i);

    });

    it('should default channel to user when omitted', async () => {

        const source = { ...makeTestConfig('source', { dialect: 'postgres', database: 'x' }), access: ADMIN };
        const dest = { ...makeTestConfig('dest', { dialect: 'postgres', database: 'y' }), access: VIEWER };

        const [result, err] = await transferData(source, dest, {});

        expect(result).toBeNull();
        expect(err?.message).toMatch(/db:reset/);

    });

    // The plan leaks destination table names, row estimates and the FK graph.
    // It was ungated while transferData was gated, and `--dry-run` /
    // `transfer.plan()` both route here — so a denied viewer read the schema
    // anyway.
    it('should deny getTransferPlan when the destination role denies transfer:plan', async () => {

        const source = { ...makeTestConfig('source', { dialect: 'postgres', database: 'x' }), access: ADMIN };
        const dest = { ...makeTestConfig('dest', { dialect: 'postgres', database: 'y' }), access: VIEWER };

        const [plan, err] = await getTransferPlan(source, dest, { channel: 'user' });

        expect(plan).toBeNull();
        expect(err?.message).toMatch(/transfer:plan/);
        expect(err?.message).toContain('dest');

    });

    it('should gate getTransferPlan on the destination, not the source', async () => {

        const source = { ...makeTestConfig('source', { dialect: 'postgres', database: 'x' }), access: VIEWER };
        const dest = { ...makeTestConfig('dest', { dialect: 'sqlite', database: 'y' }), access: ADMIN };

        const [plan, err] = await getTransferPlan(source, dest, { channel: 'user' });

        expect(plan).toBeNull();
        expect(err?.message).toMatch(/not supported/i);

    });

});
