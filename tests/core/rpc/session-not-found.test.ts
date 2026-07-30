/**
 * rpc session: real unknown-config vs agent-invisibility error parity.
 *
 * Runs `SessionManager.connect()` against a real `createContext` /
 * `StateManager` (no sdk mock — `session.test.ts` mocks `createContext` to
 * drive its other cases without a live project + identity key, which means
 * none of those tests ever exercise the resolver's actual unknown-config
 * throw). `setKeyOverride` supplies the encryption key in-memory, same as
 * `list-configs.test.ts`, so persistence never touches `~/.noorm/identity.key`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { attempt } from '@logosdx/utils';

import { SessionManager } from '../../../src/rpc/session.js';
import type { Config } from '../../../src/core/config/types.js';
import { initState, resetStateManager } from '../../../src/core/state/index.js';
import { resetSettingsManager } from '../../../src/core/settings/index.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';

function testConfig(name: string, overrides: Partial<Config> = {}): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect: 'sqlite', database: ':memory:' },
        ...overrides,
    };

}

describe('rpc: session manager (real createContext)', () => {

    let tempDir: string;

    beforeEach(async () => {

        resetStateManager();
        resetSettingsManager();
        tempDir = mkdtempSync(join(tmpdir(), 'noorm-session-not-found-'));

        const { privateKey } = await generateKeyPair();
        setKeyOverride(privateKey);

        const manager = await initState(tempDir);
        await manager.setConfig('hidden', testConfig('hidden', { access: { user: 'admin', agent: false } }));

    });

    afterEach(() => {

        clearKeyOverride();
        resetStateManager();
        resetSettingsManager();
        rmSync(tempDir, { recursive: true, force: true });

    });

    it('should throw the byte-identical error for a real hidden config and a real unknown config', async () => {

        const agentSession = new SessionManager('agent');

        const [, unknownErr] = await attempt(() => agentSession.connect('ghost'));
        const [, hiddenErr] = await attempt(() => agentSession.connect('hidden'));

        expect(unknownErr).toBeDefined();
        expect(hiddenErr).toBeDefined();
        expect(hiddenErr!.message).toBe(unknownErr!.message.replace('ghost', 'hidden'));

    });

});
