/**
 * Tests for useVaultSecretKeys hook.
 *
 * The hook must tell "there is no vault here" apart from "the vault read
 * failed". Conflating them is what made decrypt and permissions failures
 * look like an empty vault, so both halves of that boundary are asserted.
 *
 * Drives the real AppContextProvider rather than stubbing useAppContext —
 * mocking src/tui/app-context.js leaks into sibling TUI test files.
 */
import React, { useEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi, mock } from 'bun:test';
import { render } from 'ink-testing-library';
import { Text } from 'ink';

import { AppContextProvider } from '../../../src/tui/app-context.js';
import { useVaultSecretKeys, type VaultSecretKeysResult } from '../../../src/tui/hooks/useVaultSecretKeys.js';
import type { VaultStatus } from '../../../src/core/vault/index.js';

// Pre-import actual modules for restoration
const actualCore = await import('../../../src/core/index.js');
const actualIdentity = await import('../../../src/core/identity/index.js');
const actualUseConnection = await import('../../../src/tui/hooks/useConnection.js');
const actualVault = await import('../../../src/core/vault/index.js');
const actualStorage = await import('../../../src/core/identity/storage.js');

const testConfig = {
    name: 'dev',
    type: 'local' as const,
    isTest: false,
    access: { user: 'admin' as const, mcp: 'admin' as const },
    connection: {
        dialect: 'postgres' as const,
        host: 'localhost',
        port: 5432,
        database: 'dev_db',
    },
};

const mockStateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn(() => testConfig),
    getActiveConfigName: vi.fn(() => 'dev'),
    listConfigs: vi.fn(() => []),
    hasPrivateKey: vi.fn(() => false),
    isLoaded: true,
};

const mockSettingsManager = {
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn(() => ({})),
    getRequiredSecrets: vi.fn(() => []),
};

mock.module('../../../src/core/index.js', () => ({
    observer: actualCore.observer,
    getStateManager: vi.fn(() => mockStateManager),
    getSettingsManager: vi.fn(() => mockSettingsManager),
    resetStateManager: vi.fn(),
    resetSettingsManager: vi.fn(),
}));

mock.module('../../../src/core/identity/index.js', () => ({
    loadExistingIdentity: vi.fn().mockResolvedValue({ identityHash: 'hash123' }),
}));

// Spread the real modules so only the exports under test are replaced
mock.module('../../../src/tui/hooks/useConnection.js', () => ({
    ...actualUseConnection,
    useConnection: vi.fn(),
}));

mock.module('../../../src/core/vault/index.js', () => ({
    ...actualVault,
    getVaultStatus: vi.fn(),
    getVaultKey: vi.fn(),
    getAllVaultSecrets: vi.fn(),
}));

mock.module('../../../src/core/identity/storage.js', () => ({
    ...actualStorage,
    loadPrivateKey: vi.fn(),
}));

// Import mocked modules
import { useConnection } from '../../../src/tui/hooks/useConnection.js';
import { getVaultStatus, getVaultKey, getAllVaultSecrets } from '../../../src/core/vault/index.js';
import { loadPrivateKey } from '../../../src/core/identity/storage.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const vaultStatus = (hasAccess: boolean): VaultStatus => ({
    isInitialized: true,
    hasAccess,
    secretCount: 0,
    usersWithAccess: 1,
    usersWithoutAccess: 0,
});

/**
 * Test wrapper component that exposes hook state.
 */
function TestComponent({ onResult }: { onResult: (result: VaultSecretKeysResult) => void }) {

    const result = useVaultSecretKeys();

    useEffect(() => {

        onResult(result);

    }, [result, onResult]);

    return <Text>{result.vaultError ?? 'no-error'}</Text>;

}

describe('cli: useVaultSecretKeys', () => {

    let latestResult: VaultSecretKeysResult | null = null;

    const captureResult = (result: VaultSecretKeysResult) => {

        latestResult = result;

    };

    beforeEach(() => {

        vi.clearAllMocks();
        actualCore.observer.clear();
        latestResult = null;

        mockStateManager.getActiveConfig.mockReturnValue(testConfig);
        mockStateManager.getActiveConfigName.mockReturnValue('dev');
        mockStateManager.listConfigs.mockReturnValue([]);
        mockSettingsManager.getStages.mockReturnValue({});
        mockSettingsManager.getRequiredSecrets.mockReturnValue([]);

        (useConnection as any).mockReturnValue({
            db: {},
            dialect: 'postgres',
            loading: false,
            error: null,
        });

        (getVaultStatus as any).mockResolvedValue(vaultStatus(true));
        (loadPrivateKey as any).mockResolvedValue('private-key-hex');
        (getVaultKey as any).mockResolvedValue(Buffer.from('vault-key'));
        (getAllVaultSecrets as any).mockResolvedValue({});

    });

    afterEach(() => {

        actualCore.observer.clear();

    });

    // Restore mocked modules to prevent pollution of subsequent test files
    afterAll(() => {

        mock.module('../../../src/core/index.js', () => actualCore);
        mock.module('../../../src/core/identity/index.js', () => actualIdentity);
        mock.module('../../../src/tui/hooks/useConnection.js', () => actualUseConnection);
        mock.module('../../../src/core/vault/index.js', () => actualVault);
        mock.module('../../../src/core/identity/storage.js', () => actualStorage);

    });

    const renderHook = async () => {

        const rendered = render(
            <AppContextProvider autoLoad={true}>
                <TestComponent onResult={captureResult} />
            </AppContextProvider>,
        );

        await new Promise((r) => setTimeout(r, 150));

        return rendered;

    };

    it('should expose vault secret keys on success', async () => {

        (getAllVaultSecrets as any).mockResolvedValue({
            API_KEY: { key: 'API_KEY', value: 'v' },
            DB_PASS: { key: 'DB_PASS', value: 'v' },
        });

        const { unmount } = await renderHook();

        expect(latestResult?.vaultSecretKeys.sort()).toEqual(['API_KEY', 'DB_PASS']);
        expect(latestResult?.vaultError).toBeNull();

        unmount();

    });

    it('should stay quiet when the identity has no vault access', async () => {

        (getVaultStatus as any).mockResolvedValue(vaultStatus(false));

        const { lastFrame, unmount } = await renderHook();

        expect(latestResult?.vaultError).toBeNull();
        expect(latestResult?.vaultSecretKeys).toEqual([]);
        expect(lastFrame()).toContain('no-error');

        unmount();

    });

    it('should stay quiet when no private key exists on disk', async () => {

        (loadPrivateKey as any).mockResolvedValue(null);

        const { unmount } = await renderHook();

        expect(latestResult?.vaultError).toBeNull();
        expect(latestResult?.vaultSecretKeys).toEqual([]);

        unmount();

    });

    it('should stay quiet when the identity has no vault key row', async () => {

        (getVaultKey as any).mockResolvedValue(null);

        const { unmount } = await renderHook();

        expect(latestResult?.vaultError).toBeNull();
        expect(latestResult?.vaultSecretKeys).toEqual([]);

        unmount();

    });

    it('should surface an error when the private key cannot be read', async () => {

        (loadPrivateKey as any).mockRejectedValue(
            new Error('Insecure permissions on private key file'),
        );

        const { unmount } = await renderHook();

        expect(latestResult?.vaultError).toContain('Could not load private key');
        expect(latestResult?.vaultError).toContain('Insecure permissions');

        unmount();

    });

    it('should surface an error when reading vault secrets fails', async () => {

        (getAllVaultSecrets as any).mockRejectedValue(new Error('connection lost'));

        const { unmount } = await renderHook();

        expect(latestResult?.vaultError).toContain('Could not read vault secrets');
        expect(latestResult?.vaultSecretKeys).toEqual([]);

        unmount();

    });

    it('should surface an error when the vault status read fails', async () => {

        (getVaultStatus as any).mockRejectedValue(new Error('no such table'));

        const { unmount } = await renderHook();

        expect(latestResult?.vaultError).toContain('Could not read vault status');

        unmount();

    });

    it('should surface an error when unlocking the vault fails', async () => {

        (getVaultKey as any).mockRejectedValue(new Error('decrypt failed'));

        const { unmount } = await renderHook();

        expect(latestResult?.vaultError).toContain('Could not unlock vault');

        unmount();

    });

});
