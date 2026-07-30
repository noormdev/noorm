/**
 * The escalation this channel rename exists to close.
 *
 * `channel` used to name the transport, not the caller, and the CLI
 * hardcoded `user` at every policy call site. So an agent that was refused a
 * write over MCP could see `noorm` on the PATH, shell out, and run the same
 * operation with the human's role. Measured against a stock config:
 *
 *     permission     via MCP    via CLI
 *     sql:write      deny       ALLOW
 *     sql:ddl        deny       ALLOW
 *     db:create      deny       ALLOW
 *     db:destroy     deny       confirm   <- and --yes satisfies confirm
 *     run:build      deny       ALLOW
 *     vault:read     deny       ALLOW
 *
 * That table is this file's spec. It asserts the property, not the current
 * numbers: for a stock config, *nothing* an agent is denied on one route may
 * be reachable on the other. A future matrix edit that reopens any cell for
 * agents fails here even if it never touches this file.
 *
 * The end-to-end half — that the shipped binary actually resolves `agent`
 * from harness provenance — lives in tests/cli/agent-channel-escalation.test.ts.
 */
import { describe, it, expect } from 'bun:test';

import { parseConfig } from '../../../src/core/config/index.js';
import { checkPolicy, resolveChannel } from '../../../src/core/policy/index.js';
import { MATRIX } from '../../../src/core/policy/matrix.js';
import type { ConfigAccess, Permission } from '../../../src/core/policy/index.js';

/** Access of a config exactly as it lands on disk: no `access` key written. */
function stockAccess(): ConfigAccess {

    return parseConfig({
        name: 'stock',
        type: 'local',
        isTest: true,
        connection: { dialect: 'sqlite', database: ':memory:' },
    }).access;

}

const ALL_PERMISSIONS = Object.keys(MATRIX) as Permission[];

/** The environment an agent harness exports for its child processes. */
const AGENT_ENV = { CLAUDECODE: '1' };

/** The permissions measured as escalatable before the fix. */
const MEASURED: Permission[] = [
    'sql:write',
    'sql:ddl',
    'db:create',
    'db:destroy',
    'run:build',
    'vault:read',
];

describe('policy: agent escalation via the CLI', () => {

    it('should resolve the agent channel from harness provenance', () => {

        // Everything below rests on this: the CLI reaches checkPolicy with
        // whatever resolveChannel() returns, so if this drifts back to
        // 'user' the whole gate is decorative again.
        expect(resolveChannel(AGENT_ENV)).toBe('agent');

    });

    for (const permission of MEASURED) {

        it(`should deny "${permission}" on the channel a harnessed CLI resolves`, () => {

            const channel = resolveChannel(AGENT_ENV);
            const check = checkPolicy(channel, { name: 'stock', access: stockAccess() }, permission);

            expect(check.allowed).toBe(false);

            // Not merely "needs confirmation": on the CLI a confirm cell is
            // one --yes away from proceeding, which is exactly how
            // db:destroy leaked before.
            expect(check.requiresConfirmation).toBe(false);

        });

    }

    for (const permission of ALL_PERMISSIONS) {

        it(`should give "${permission}" the same answer over MCP and over the CLI`, () => {

            const target = { name: 'stock', access: stockAccess() };

            // The MCP server constructs its session with 'agent' literally.
            const viaMcp = checkPolicy('agent', target, permission);

            // The CLI resolves the channel from the environment it was
            // spawned into.
            const viaCli = checkPolicy(resolveChannel(AGENT_ENV), target, permission);

            expect(viaCli.allowed).toBe(viaMcp.allowed);
            expect(viaCli.requiresConfirmation).toBe(viaMcp.requiresConfirmation);

        });

    }

    it('should keep the human route open, or the fix is a regression not a gate', () => {

        // The point is to stop an agent inheriting the human's role, not to
        // take it away from the human.
        const target = { name: 'stock', access: stockAccess() };

        for (const permission of MEASURED) {

            expect(checkPolicy('user', target, permission).allowed).toBe(true);

        }

    });

    it('should let a human scripting inside an agent session opt back in', () => {

        const target = { name: 'stock', access: stockAccess() };
        const channel = resolveChannel({ ...AGENT_ENV, NOORM_CHANNEL: 'user' });

        expect(channel).toBe('user');
        expect(checkPolicy(channel, target, 'sql:write').allowed).toBe(true);

    });

    describe('agent: false hides the config from both routes', () => {

        const hidden = parseConfig({
            name: 'hidden',
            type: 'local',
            isTest: true,
            access: { user: 'admin', agent: false },
            connection: { dialect: 'sqlite', database: ':memory:' },
        }).access;

        it('should deny every permission to a harnessed CLI caller', () => {

            const channel = resolveChannel(AGENT_ENV);

            for (const permission of ALL_PERMISSIONS) {

                expect(checkPolicy(channel, { name: 'hidden', access: hidden }, permission).allowed).toBe(false);

            }

        });

        it('should still serve the human', () => {

            expect(checkPolicy('user', { name: 'hidden', access: hidden }, 'sql:read').allowed).toBe(true);

        });

    });

});
