/**
 * transferData policy-gate unit tests.
 *
 * Proves transferData gates on the DESTINATION config's access role (not
 * the source) before any connection is attempted — no container required
 * since a deny returns before withDualConnection ever opens a socket.
 */
import { describe, it, expect } from 'bun:test';

import { transferData } from '../../../src/core/transfer/index.js';
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

});
