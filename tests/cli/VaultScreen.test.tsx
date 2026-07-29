/**
 * VaultScreen propagation confirmation tests.
 *
 * `p` used to call `propagateVaultKey` directly from the keypress handler --
 * one unmodified key, no confirmation, no policy check, for an operation that
 * hands the vault key (and therefore every secret in the vault) to every
 * enrolled identity at once. The CLI's `vault propagate` is a deliberate
 * invocation; the TUI's was a typo away.
 *
 * These pin the two halves of the fix: the keypress must not write anything on
 * its own, and the confirmation it opens must name the people being granted
 * access so the operator can see the blast radius before agreeing to it.
 *
 * LOCATION: this file lives at tests/cli/ rather than the tests/cli/screens/vault/
 * it belongs in, and that is load-bearing. bun's `mock.module` registry is
 * process-global, and tests/cli/hooks/useVaultSecretKeys.test.tsx also mocks
 * core/vault -- restoring it to the real module in its afterAll. CI runs
 * tests/cli as one process (.github/workflows/ci.yml), so whichever file bun
 * loads first decides what the other one's subject binds to: from
 * tests/cli/screens/vault/ these tests ran against the real, unmocked vault and
 * failed only in the combined run, never standalone. Moving this file back
 * under screens/ reintroduces that. The durable fix is a separate test process
 * for the TUI screens, not a different mock arrangement -- several were tried.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CryptoIdentity } from '../../src/core/identity/types.js';

import { FocusProvider } from '../../src/tui/focus.js';
import { RouterProvider } from '../../src/tui/router.js';
import { AppContextProvider } from '../../src/tui/app-context.js';
import { ConnectionProvider } from '../../src/tui/providers/ConnectionProvider.js';
import { ToastProvider } from '../../src/tui/components/index.js';
import { VaultScreen } from '../../src/tui/screens/vault/VaultScreen.js';

const actualCore = await import('../../src/core/index.js');
const actualIdentity = await import('../../src/core/identity/index.js');
const actualIdentityStorage = await import('../../src/core/identity/storage.js');
const actualVault = await import('../../src/core/vault/index.js');

/** Every call to the real propagation entry point. */
const propagateCalls: unknown[] = [];

const IDENTITY: CryptoIdentity = {
    identityHash: 'hash-self',
    name: 'Self',
    email: 'self@example.com',
    publicKey: 'pub-self',
    machine: 'test',
    os: 'test',
    createdAt: new Date().toISOString(),
};

/** Two enrolled identities awaiting access — the names the dialog must show. */
const RECIPIENTS = [
    { identityHash: 'hash-a', publicKey: 'pub-a', name: 'Ada Lovelace', email: 'ada@example.com' },
    { identityHash: 'hash-b', publicKey: 'pub-b', name: 'Grace Hopper', email: 'grace@example.com' },
];

mock.module('../../src/core/vault/index.js', () => ({
    ...actualVault,
    getVaultStatus: vi.fn(async () => ({
        isInitialized: true,
        hasAccess: true,
        usersWithAccess: 1,
        usersWithoutAccess: RECIPIENTS.length,
    })),
    getAllVaultSecrets: vi.fn(async () => []),
    getVaultKey: vi.fn(async () => 'vault-key'),
    // Mirrors the real `[users, error]` tuple: a failed lookup must not be
    // indistinguishable from "nobody is missing access". Returning a bare array
    // here let the screen and the mock agree on a shape the core had stopped
    // using, so the suite stayed green over a real runtime bug.
    getUsersWithoutVaultAccess: vi.fn(async () => [RECIPIENTS, null]),
    propagateVaultKey: vi.fn(async (...args: unknown[]) => {

        propagateCalls.push(args);

        return { propagatedTo: RECIPIENTS.map((r) => r.identityHash), skipped: [] };

    }),
}));

mock.module('../../src/core/identity/storage.js', () => ({
    ...actualIdentityStorage,
    loadPrivateKey: vi.fn(async () => 'private-key'),
}));

/**
 * `admin` still resolves `vault:propagate` to a `confirm` cell
 * (src/core/policy/matrix.ts), so this config exercises the type-to-confirm
 * branch rather than a plain yes/no.
 */
function makeConfig() {

    return {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        access: { user: 'admin' as const, mcp: 'admin' as const },
        connection: {
            dialect: 'sqlite' as const,
            database: ':memory:',
        },
    };

}

const createMockStateManager = () => ({
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(makeConfig()),
    getActiveConfigName: vi.fn().mockReturnValue('test'),
    listConfigs: vi.fn().mockReturnValue([makeConfig()]),
    getConfig: vi.fn().mockReturnValue(makeConfig()),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
});

const createMockSettingsManager = () => ({
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn().mockReturnValue(undefined),
});

let mockStateManager = createMockStateManager();
let mockSettingsManager = createMockSettingsManager();

mock.module('../../src/core/index.js', () => ({
    observer: actualCore.observer,
    getStateManager: vi.fn(() => mockStateManager),
    getSettingsManager: vi.fn(() => mockSettingsManager),
    resetStateManager: vi.fn(),
    resetSettingsManager: vi.fn(),
}));

mock.module('../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: vi.fn().mockResolvedValue(IDENTITY),
}));

describe('cli: VaultScreen propagate', () => {

    let tempDir: string;

    const ESCAPE = '\u001B';

    const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms));

    function tree() {

        return (
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tempDir} autoLoad={true}>
                        <ConnectionProvider>
                            <ToastProvider>
                                <VaultScreen params={{}} />
                            </ToastProvider>
                        </ConnectionProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>
        );

    }

    beforeEach(async () => {

        vi.clearAllMocks();
        actualCore.observer.clear();

        delete process.env['NOORM_YES'];

        propagateCalls.length = 0;
        mockStateManager = createMockStateManager();
        mockSettingsManager = createMockSettingsManager();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-vault-test-'));

    });

    afterEach(async () => {

        actualCore.observer.clear();

        await rm(tempDir, { recursive: true, force: true });

    });

    afterAll(() => {

        mock.module('../../src/core/index.js', () => actualCore);
        mock.module('../../src/core/identity/index.js', () => actualIdentity);
        mock.module('../../src/core/identity/storage.js', () => actualIdentityStorage);
        mock.module('../../src/core/vault/index.js', () => actualVault);

    });

    it('should not propagate on the bare p keypress', async () => {

        const { stdin, unmount } = render(tree());

        await tick(600);

        stdin.write('p');
        await tick(400);

        unmount();

        expect(propagateCalls).toHaveLength(0);

    });

    it('should name every recipient before propagating', async () => {

        const { stdin, lastFrame, unmount } = render(tree());

        await tick(600);

        stdin.write('p');
        await tick(400);

        const frame = lastFrame() ?? '';

        // The whole point of the confirmation: who is getting the key.
        expect(frame).toContain('Ada Lovelace');
        expect(frame).toContain('Grace Hopper');

        unmount();

    });

    it('should propagate once the confirmation phrase is typed', async () => {

        const { stdin, unmount } = render(tree());

        await tick(600);

        stdin.write('p');
        await tick(400);

        stdin.write('yes-test');
        await tick();
        stdin.write('\r');
        await tick(400);

        unmount();

        expect(propagateCalls).toHaveLength(1);

    });

    it('should not propagate when the confirmation is cancelled', async () => {

        const { stdin, unmount } = render(tree());

        await tick(600);

        stdin.write('p');
        await tick(400);

        stdin.write(ESCAPE);
        await tick(400);

        unmount();

        expect(propagateCalls).toHaveLength(0);

    });

});
