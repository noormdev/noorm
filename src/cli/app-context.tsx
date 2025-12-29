/**
 * App Context - Centralized state orchestration for the CLI.
 *
 * Bridges core modules with the view layer by:
 * 1. Instantiating core managers (StateManager, SettingsManager)
 * 2. Subscribing to observer events
 * 3. Exposing reactive state for components to consume
 *
 * This is a thin orchestration layer with no business logic.
 * All logic belongs in core modules.
 *
 * @example
 * ```tsx
 * function App() {
 *     return (
 *         <AppContextProvider projectRoot={process.cwd()}>
 *             <StatusBar />
 *             <ScreenRenderer />
 *         </AppContextProvider>
 *     )
 * }
 *
 * function StatusBar() {
 *     const { activeConfig, connectionStatus, lockStatus } = useAppContext()
 *     return (
 *         <Text>
 *             {activeConfig?.name ?? 'none'} |
 *             {connectionStatus} |
 *             {lockStatus.status}
 *         </Text>
 *     )
 * }
 * ```
 */
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Text } from 'ink';
import { attempt, attemptSync } from '@logosdx/utils';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

import {
    observer,
    getStateManager,
    getSettingsManager,
    type Config,
    type ConfigSummary,
    type Settings,
} from '../core/index.js';
import type { StateManager } from '../core/state/manager.js';
import type { SettingsManager } from '../core/settings/manager.js';
import type { CryptoIdentity } from '../core/identity/types.js';

// ─────────────────────────────────────────────────────────────
// Project Name Detection
// ─────────────────────────────────────────────────────────────

/**
 * Detect project name from package.json, git remote, or folder name.
 *
 * Hierarchy:
 * 1. package.json "name" field
 * 2. git remote origin (user/repo format)
 * 3. folder name
 */
function detectProjectName(projectRoot: string): string {

    // Try package.json first
    const packageJsonPath = join(projectRoot, 'package.json');

    if (existsSync(packageJsonPath)) {

        const [content] = attemptSync(() => readFileSync(packageJsonPath, 'utf8'));

        if (content) {

            const [parsed] = attemptSync(() => JSON.parse(content) as { name?: string });

            if (parsed?.name) {

                return parsed.name;

            }

        }

    }

    // Try git remote origin
    const [gitRemote] = attemptSync(() =>
        execSync('git remote get-url origin', {
            cwd: projectRoot,
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim(),
    );

    if (gitRemote) {

        // Parse user/repo from various git URL formats:
        // - https://github.com/user/repo.git
        // - git@github.com:user/repo.git
        // - ssh://git@github.com/user/repo.git
        const match = gitRemote.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);

        if (match) {

            return `${match[1]}/${match[2]}`;

        }

    }

    // Fallback to folder name
    return basename(projectRoot);

}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Loading status for the app context.
 */
export type LoadingStatus =
    | 'not-initialized' // Initial state before load()
    | 'loading' // Currently loading state/settings
    | 'ready' // Successfully loaded
    | 'error'; // Failed to load

/**
 * Connection status derived from observer events.
 */
export type ConnectionStatus =
    | 'disconnected' // No active connection
    | 'connected' // Connection open
    | 'error'; // Connection failed

/**
 * Lock status derived from observer events.
 */
export interface LockStatusInfo {
    /** Whether any lock is held */
    status: 'free' | 'locked' | 'blocked';

    /** Identity holding the lock (if locked) */
    holder?: string;

    /** When lock was acquired (if locked) */
    since?: Date;

    /** When lock expires (if locked) */
    expiresAt?: Date;
}

/**
 * Context value exposed to consumers.
 */
export interface AppContextValue {
    // Loading state
    loadingStatus: LoadingStatus;
    error: Error | null;

    // Project info
    projectName: string;

    // Core managers (null until loaded)
    stateManager: StateManager | null;
    settingsManager: SettingsManager | null;

    // Active config info (derived from state manager)
    activeConfig: Config | null;
    activeConfigName: string | null;
    configs: ConfigSummary[];

    // Identity info
    identity: CryptoIdentity | null;
    hasIdentity: boolean;

    // Settings info
    settings: Settings | null;

    // Connection status (from observer events)
    connectionStatus: ConnectionStatus;
    connectedConfig: string | null;

    // Lock status (from observer events)
    lockStatus: LockStatusInfo;

    // Actions
    refresh: () => Promise<void>;
    setActiveConfig: (name: string) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Props for AppContextProvider.
 */
export interface AppContextProviderProps {
    /** Project root directory (defaults to process.cwd()) */
    projectRoot?: string;

    /** Whether to auto-load on mount (defaults to true) */
    autoLoad?: boolean;

    /** Children to render */
    children: ReactNode;
}

/**
 * Provides app context to the component tree.
 *
 * Loads StateManager and SettingsManager on mount,
 * subscribes to observer events, and exposes reactive state.
 *
 * @example
 * ```tsx
 * <AppContextProvider projectRoot="/path/to/project">
 *     <App />
 * </AppContextProvider>
 * ```
 */
export function AppContextProvider({
    projectRoot = process.cwd(),
    autoLoad = true,
    children,
}: AppContextProviderProps) {

    // Project name (detected once from package.json, git remote, or folder)
    const projectName = useMemo(() => detectProjectName(projectRoot), [projectRoot]);

    // Loading state
    const [loadingStatus, setLoadingStatus] = useState<LoadingStatus>('not-initialized');
    const [error, setError] = useState<Error | null>(null);

    // Core managers
    const [stateManager, setStateManager] = useState<StateManager | null>(null);
    const [settingsManager, setSettingsManager] = useState<SettingsManager | null>(null);

    // Derived state from managers (refreshed via events)
    const [activeConfig, setActiveConfig] = useState<Config | null>(null);
    const [activeConfigName, setActiveConfigName] = useState<string | null>(null);
    const [configs, setConfigs] = useState<ConfigSummary[]>([]);
    const [identity, setIdentity] = useState<CryptoIdentity | null>(null);
    const [settings, setSettings] = useState<Settings | null>(null);

    // Observer-driven state
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
    const [connectedConfig, setConnectedConfig] = useState<string | null>(null);
    const [lockStatus, setLockStatus] = useState<LockStatusInfo>({ status: 'free' });

    /**
     * Sync derived state from loaded managers.
     */
    const syncStateFromManagers = useCallback(
        (sm: StateManager | null, settingsM: SettingsManager | null) => {

            if (sm) {

                setActiveConfig(sm.getActiveConfig());
                setActiveConfigName(sm.getActiveConfigName());
                setConfigs(sm.listConfigs());
                setIdentity(sm.getIdentity());

            }

            if (settingsM && settingsM.isLoaded) {

                setSettings(settingsM.settings);

            }

        },
        [],
    );

    /**
     * Load state and settings managers.
     */
    const load = useCallback(async () => {

        setLoadingStatus('loading');
        setError(null);

        // Get managers (may already exist as singletons)
        const sm = getStateManager(projectRoot);
        const settingsM = getSettingsManager(projectRoot);

        // Load both
        const [, loadErr] = await attempt(async () => {

            await sm.load();
            await settingsM.load();

        });

        if (loadErr) {

            setError(loadErr instanceof Error ? loadErr : new Error(String(loadErr)));
            setLoadingStatus('error');

            return;

        }

        setStateManager(sm);
        setSettingsManager(settingsM);

        // Sync initial state
        syncStateFromManagers(sm, settingsM);

        setLoadingStatus('ready');

    }, [projectRoot, syncStateFromManagers]);

    /**
     * Refresh state from managers.
     */
    const refresh = useCallback(async () => {

        syncStateFromManagers(stateManager, settingsManager);

    }, [stateManager, settingsManager, syncStateFromManagers]);

    /**
     * Set active config (delegates to StateManager).
     */
    const handleSetActiveConfig = useCallback(
        async (name: string) => {

            if (!stateManager) return;

            await stateManager.setActiveConfig(name);
            // State will sync via observer event

        },
        [stateManager],
    );

    // Auto-load on mount
    useEffect(() => {

        if (autoLoad && loadingStatus === 'not-initialized') {

            load();

        }

    }, [autoLoad, loadingStatus, load]);

    // Subscribe to observer events
    useEffect(() => {

        const cleanups: Array<() => void> = [];

        // State events
        cleanups.push(
            observer.on('state:loaded', (data) => {

                setActiveConfigName(data.activeConfig);
                if (stateManager) {

                    setActiveConfig(stateManager.getActiveConfig());
                    setConfigs(stateManager.listConfigs());
                    setIdentity(stateManager.getIdentity());

                }

            }),
        );

        cleanups.push(
            observer.on('config:activated', (data) => {

                setActiveConfigName(data.name);
                if (stateManager) {

                    setActiveConfig(stateManager.getConfig(data.name));
                    setConfigs(stateManager.listConfigs());

                }

            }),
        );

        cleanups.push(
            observer.on('config:created', () => {

                if (stateManager) {

                    setConfigs(stateManager.listConfigs());

                }

            }),
        );

        cleanups.push(
            observer.on('config:deleted', () => {

                if (stateManager) {

                    setActiveConfig(stateManager.getActiveConfig());
                    setActiveConfigName(stateManager.getActiveConfigName());
                    setConfigs(stateManager.listConfigs());

                }

            }),
        );

        cleanups.push(
            observer.on('identity:created', (_data) => {

                if (stateManager) {

                    setIdentity(stateManager.getIdentity());

                }

            }),
        );

        // Connection events
        cleanups.push(
            observer.on('connection:open', (data) => {

                setConnectionStatus('connected');
                setConnectedConfig(data.configName);

            }),
        );

        cleanups.push(
            observer.on('connection:close', (data) => {

                if (connectedConfig === data.configName) {

                    setConnectionStatus('disconnected');
                    setConnectedConfig(null);

                }

            }),
        );

        cleanups.push(
            observer.on('connection:error', (data) => {

                if (connectedConfig === data.configName || !connectedConfig) {

                    setConnectionStatus('error');

                }

            }),
        );

        // Lock events
        cleanups.push(
            observer.on('lock:acquired', (data) => {

                setLockStatus({
                    status: 'locked',
                    holder: data.identity,
                    expiresAt: data.expiresAt,
                });

            }),
        );

        cleanups.push(
            observer.on('lock:released', () => {

                setLockStatus({ status: 'free' });

            }),
        );

        cleanups.push(
            observer.on('lock:blocked', (data) => {

                setLockStatus({
                    status: 'blocked',
                    holder: data.holder,
                    since: data.heldSince,
                });

            }),
        );

        cleanups.push(
            observer.on('lock:expired', () => {

                setLockStatus({ status: 'free' });

            }),
        );

        return () => {

            for (const cleanup of cleanups) {

                cleanup();

            }

        };

    }, [stateManager, connectedConfig]);

    // Memoize context value
    const value = useMemo<AppContextValue>(
        () => ({
            loadingStatus,
            error,
            projectName,
            stateManager,
            settingsManager,
            activeConfig,
            activeConfigName,
            configs,
            identity,
            hasIdentity: identity !== null,
            settings,
            connectionStatus,
            connectedConfig,
            lockStatus,
            refresh,
            setActiveConfig: handleSetActiveConfig,
        }),
        [
            loadingStatus,
            error,
            projectName,
            stateManager,
            settingsManager,
            activeConfig,
            activeConfigName,
            configs,
            identity,
            settings,
            connectionStatus,
            connectedConfig,
            lockStatus,
            refresh,
            handleSetActiveConfig,
        ],
    );

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;

}

// ─────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────

/**
 * Get the full app context.
 *
 * Must be used within an AppContextProvider.
 *
 * @throws Error if used outside AppContextProvider
 *
 * @example
 * ```tsx
 * function StatusBar() {
 *     const { activeConfigName, connectionStatus, lockStatus } = useAppContext()
 *
 *     return (
 *         <Box>
 *             <Text>{activeConfigName ?? 'none'}</Text>
 *             <Text>{connectionStatus}</Text>
 *             <Text>{lockStatus.status}</Text>
 *         </Box>
 *     )
 * }
 * ```
 */
export function useAppContext(): AppContextValue {

    const context = useContext(AppContext);

    if (!context) {

        throw new Error('useAppContext must be used within an AppContextProvider');

    }

    return context;

}

/**
 * Get loading status and error.
 *
 * Useful for guards and loading states.
 *
 * @example
 * ```tsx
 * function LoadingGuard({ children }: { children: ReactNode }) {
 *     const { loadingStatus, error } = useLoadingStatus()
 *
 *     if (loadingStatus === 'loading') return <Text>Loading...</Text>
 *     if (loadingStatus === 'error') return <Text color="red">{error?.message}</Text>
 *
 *     return <>{children}</>
 * }
 * ```
 */
export function useLoadingStatus(): Pick<AppContextValue, 'loadingStatus' | 'error'> {

    const { loadingStatus, error } = useAppContext();

    return { loadingStatus, error };

}

/**
 * Get active config info.
 *
 * @example
 * ```tsx
 * function ConfigDisplay() {
 *     const { activeConfig, activeConfigName } = useActiveConfig()
 *
 *     if (!activeConfig) return <Text dimColor>No config selected</Text>
 *
 *     return <Text>{activeConfigName}: {activeConfig.type}</Text>
 * }
 * ```
 */
export function useActiveConfig(): Pick<
    AppContextValue,
    'activeConfig' | 'activeConfigName' | 'configs'
    > {

    const { activeConfig, activeConfigName, configs } = useAppContext();

    return { activeConfig, activeConfigName, configs };

}

/**
 * Get connection status.
 *
 * @example
 * ```tsx
 * function ConnectionIndicator() {
 *     const { connectionStatus, connectedConfig } = useConnectionStatus()
 *
 *     return (
 *         <Text color={connectionStatus === 'connected' ? 'green' : 'gray'}>
 *             {connectionStatus === 'connected' ? '●' : '○'}
 *         </Text>
 *     )
 * }
 * ```
 */
export function useConnectionStatus(): Pick<
    AppContextValue,
    'connectionStatus' | 'connectedConfig'
    > {

    const { connectionStatus, connectedConfig } = useAppContext();

    return { connectionStatus, connectedConfig };

}

/**
 * Get lock status.
 *
 * @example
 * ```tsx
 * function LockIndicator() {
 *     const { lockStatus } = useLockStatus()
 *
 *     if (lockStatus.status === 'free') {
 *         return <Text color="green">🔓</Text>
 *     }
 *
 *     return <Text color="yellow">🔒 {lockStatus.holder}</Text>
 * }
 * ```
 */
export function useLockStatus(): Pick<AppContextValue, 'lockStatus'> {

    const { lockStatus } = useAppContext();

    return { lockStatus };

}

/**
 * Get project name.
 *
 * Returns the detected project name (from package.json, git remote, or folder).
 *
 * @example
 * ```tsx
 * function Header() {
 *     const { projectName } = useProjectName()
 *     return <Text bold>{projectName}</Text>
 * }
 * ```
 */
export function useProjectName(): Pick<AppContextValue, 'projectName'> {

    const { projectName } = useAppContext();

    return { projectName };

}

/**
 * Get identity info.
 *
 * @example
 * ```tsx
 * function IdentityDisplay() {
 *     const { identity, hasIdentity } = useIdentity()
 *
 *     if (!hasIdentity) return <Text dimColor>No identity</Text>
 *
 *     return <Text>{identity?.name} &lt;{identity?.email}&gt;</Text>
 * }
 * ```
 */
export function useIdentity(): Pick<AppContextValue, 'identity' | 'hasIdentity'> {

    const { identity, hasIdentity } = useAppContext();

    return { identity, hasIdentity };

}

/**
 * Get settings info.
 *
 * @example
 * ```tsx
 * function SettingsDisplay() {
 *     const { settings, settingsManager } = useSettings()
 *
 *     if (!settings) return <Text dimColor>No settings</Text>
 *
 *     const stages = settingsManager?.getStages() ?? {}
 *     return <Text>Stages: {Object.keys(stages).join(', ')}</Text>
 * }
 * ```
 */
export function useSettings(): Pick<AppContextValue, 'settings' | 'settingsManager'> {

    const { settings, settingsManager } = useAppContext();

    return { settings, settingsManager };

}

// ─────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────

/**
 * Props for LoadingGuard.
 */
export interface LoadingGuardProps {
    /** Content to show while loading */
    loading?: ReactNode;

    /** Content to show on error */
    error?: ReactNode | ((error: Error) => ReactNode);

    /** Children to render when ready */
    children: ReactNode;
}

/**
 * Guard component that shows loading/error states.
 *
 * Renders children only when the app context is ready.
 *
 * @example
 * ```tsx
 * <AppContextProvider>
 *     <LoadingGuard
 *         loading={<Text>Loading...</Text>}
 *         error={(err) => <Text color="red">{err.message}</Text>}
 *     >
 *         <MainContent />
 *     </LoadingGuard>
 * </AppContextProvider>
 * ```
 */
export function LoadingGuard({
    loading = <Text dimColor>Loading...</Text>,
    error,
    children,
}: LoadingGuardProps) {

    const { loadingStatus, error: contextError } = useLoadingStatus();

    if (loadingStatus === 'not-initialized' || loadingStatus === 'loading') {

        return <>{loading}</>;

    }

    if (loadingStatus === 'error' && contextError) {

        if (typeof error === 'function') {

            return <>{error(contextError)}</>;

        }

        return <>{error ?? <Text color="red">Error: {contextError.message}</Text>}</>;

    }

    return <>{children}</>;

}

/**
 * Props for ConfigGuard.
 */
export interface ConfigGuardProps {
    /** Content to show when no config is selected */
    fallback?: ReactNode;

    /** Children to render when config is available */
    children: ReactNode;
}

/**
 * Guard component that requires an active config.
 *
 * @example
 * ```tsx
 * <ConfigGuard fallback={<Text>Please select a config first</Text>}>
 *     <ConfigOperations />
 * </ConfigGuard>
 * ```
 */
export function ConfigGuard({
    fallback = <Text dimColor>No config selected. Use config:add to create one.</Text>,
    children,
}: ConfigGuardProps) {

    const { activeConfig } = useActiveConfig();

    if (!activeConfig) {

        return <>{fallback}</>;

    }

    return <>{children}</>;

}

/**
 * Props for IdentityGuard.
 */
export interface IdentityGuardProps {
    /** Content to show when no identity is set */
    fallback?: ReactNode;

    /** Children to render when identity is available */
    children: ReactNode;
}

/**
 * Guard component that requires identity to be set.
 *
 * @example
 * ```tsx
 * <IdentityGuard fallback={<Text>Run 'noorm init' to set up identity</Text>}>
 *     <SecureOperations />
 * </IdentityGuard>
 * ```
 */
export function IdentityGuard({
    fallback = <Text dimColor>No identity set. Run 'noorm init' first.</Text>,
    children,
}: IdentityGuardProps) {

    const { hasIdentity } = useIdentity();

    if (!hasIdentity) {

        return <>{fallback}</>;

    }

    return <>{children}</>;

}
