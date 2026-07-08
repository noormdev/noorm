import { describe, it, expect } from 'bun:test';

import { RpcRegistry } from '../../../src/rpc/registry.js';
import { registerAllCommands } from '../../../src/rpc/commands/index.js';
import type { Permission } from '../../../src/core/policy/index.js';

/**
 * Pins the security-relevant `permission` gate for every RPC command. The
 * dispatch check in `src/mcp/server.ts` is only as strong as the value each
 * command registers — a typo or an accidental flip to `'open'` would skip
 * the policy gate entirely and go undetected by any test that mocks the
 * command list instead of the real registry.
 */
const EXPECTED_PERMISSIONS: Record<string, Permission | 'open'> = {
    change_run: 'change:run',
    change_ff: 'change:ff',
    change_revert: 'change:revert',
    run_build: 'run:build',
    run_file: 'run:file',
    sql: 'sql:read',
    list: 'explore',
    detail: 'explore',
    overview: 'explore',
    change_history: 'explore',
    list_configs: 'open',
    connect: 'open',
    disconnect: 'open',
};

describe('rpc: command permissions', () => {

    const registry = new RpcRegistry();
    registerAllCommands(registry);

    for (const [name, permission] of Object.entries(EXPECTED_PERMISSIONS)) {

        it(`${name} should gate on '${permission}'`, () => {

            const cmd = registry.get(name);

            expect(cmd).toBeDefined();
            expect(cmd!.permission).toBe(permission);

        });

    }

    it('should not register any command outside the pinned table', () => {

        const registered = registry.list().map((cmd) => cmd.name).sort();
        const expected = Object.keys(EXPECTED_PERMISSIONS).sort();

        expect(registered).toEqual(expected);

    });

});
