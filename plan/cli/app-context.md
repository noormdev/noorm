# CLI App Context & Status Bar


## Overview

The App Context provides centralized state and connection management for the entire CLI application. Instead of each screen independently loading state and connections, a single `AppProvider` manages:

- State loading (async, once at startup)
- Connection lifecycle (lazy, cached, with status tracking)
- Lock status monitoring
- Global loading/error states

A floating **Status Bar** displays real-time information about the current context.


## File Structure

```
src/cli/
├── context/
│   ├── index.ts              # Public exports
│   ├── AppContext.tsx        # Main context provider
│   ├── types.ts              # Context types
│   ├── useApp.ts             # Main app hook
│   ├── useConnection.ts      # Connection hook with status
│   └── useLockStatus.ts      # Lock monitoring hook
├── components/
│   └── StatusBar.tsx         # Floating status bar component
```


## Types

```typescript
// src/cli/context/types.ts

import { Kysely } from 'kysely';
import { Config, ConfigSummary } from '../../core/config/types';
import { StateManager } from '../../core/state';
import { LockStatus } from '../../core/lock';

export type AppPhase = 'initializing' | 'ready' | 'error';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface AppState {
    phase: AppPhase;
    error: string | null;

    // State
    stateManager: StateManager | null;
    activeConfig: Config | null;
    activeConfigName: string | null;
    configs: ConfigSummary[];

    // Connection
    connectionStatus: ConnectionStatus;
    connectionError: string | null;
    db: Kysely<any> | null;

    // Lock
    lockStatus: LockStatus | null;
    lockLoading: boolean;
}

export interface AppActions {
    // State
    refreshState: () => Promise<void>;
    setActiveConfig: (name: string) => Promise<void>;

    // Connection
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    reconnect: () => Promise<void>;

    // Lock
    refreshLock: () => Promise<void>;
}

export interface AppContextValue extends AppState, AppActions {}
```


## App Context Provider

```typescript
// src/cli/context/AppContext.tsx

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    useRef,
    ReactNode,
} from 'react';
import { attempt } from '@logosdx/utils';
import { observer } from '@logosdx/observer';
import { getStateManager, StateManager } from '../../core/state';
import { createConnection, ConnectionResult } from '../../core/connection';
import { LockManager, LockStatus } from '../../core/lock';
import {
    AppState,
    AppActions,
    AppContextValue,
    AppPhase,
    ConnectionStatus,
} from './types';

const INITIAL_STATE: AppState = {
    phase: 'initializing',
    error: null,
    stateManager: null,
    activeConfig: null,
    activeConfigName: null,
    configs: [],
    connectionStatus: 'disconnected',
    connectionError: null,
    db: null,
    lockStatus: null,
    lockLoading: false,
};

const AppContext = createContext<AppContextValue | null>(null);

export interface AppProviderProps {
    children: ReactNode;
    projectRoot?: string;
}

export function AppProvider({ children, projectRoot }: AppProviderProps) {

    const [state, setState] = useState<AppState>(INITIAL_STATE);
    const connectionRef = useRef<ConnectionResult | null>(null);
    const lockIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // ─────────────────────────────────────────────────────────────
    // Initialization
    // ─────────────────────────────────────────────────────────────

    useEffect(() => {

        initializeApp();

        return () => {

            // Cleanup on unmount
            if (connectionRef.current) {
                connectionRef.current.destroy();
            }
            if (lockIntervalRef.current) {
                clearInterval(lockIntervalRef.current);
            }
        };
    }, []);

    async function initializeApp() {

        observer.emit('app:initializing', {});

        const [manager, err] = await attempt(async () => {

            const mgr = getStateManager(projectRoot);
            await mgr.load();
            return mgr;
        });

        if (err) {

            setState(s => ({
                ...s,
                phase: 'error',
                error: err.message,
            }));

            observer.emit('app:error', { error: err.message });
            return;
        }

        const configs = manager!.listConfigs();
        const activeConfigName = manager!.getActiveConfigName();
        const activeConfig = activeConfigName
            ? manager!.getConfig(activeConfigName)
            : null;

        setState(s => ({
            ...s,
            phase: 'ready',
            stateManager: manager!,
            configs,
            activeConfigName,
            activeConfig,
        }));

        observer.emit('app:ready', {
            configCount: configs.length,
            activeConfig: activeConfigName,
        });

        // Auto-connect if there's an active config
        if (activeConfig) {
            await connectToDatabase(activeConfig);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Connection Management
    // ─────────────────────────────────────────────────────────────

    async function connectToDatabase(config: Config) {

        setState(s => ({
            ...s,
            connectionStatus: 'connecting',
            connectionError: null,
        }));

        observer.emit('connection:connecting', { config: config.name });

        const [conn, err] = await attempt(() =>
            createConnection(config.connection, config.name)
        );

        if (err) {

            setState(s => ({
                ...s,
                connectionStatus: 'error',
                connectionError: err.message,
                db: null,
            }));

            observer.emit('connection:error', {
                config: config.name,
                error: err.message,
            });
            return;
        }

        // Close previous connection if exists
        if (connectionRef.current) {
            await connectionRef.current.destroy();
        }

        connectionRef.current = conn!;

        setState(s => ({
            ...s,
            connectionStatus: 'connected',
            connectionError: null,
            db: conn!.db,
        }));

        observer.emit('connection:connected', { config: config.name });

        // Start lock monitoring
        startLockMonitoring(conn!.db, config);
    }

    const connect = useCallback(async () => {

        if (!state.activeConfig) {
            return;
        }

        await connectToDatabase(state.activeConfig);
    }, [state.activeConfig]);

    const disconnect = useCallback(async () => {

        if (connectionRef.current) {
            await connectionRef.current.destroy();
            connectionRef.current = null;
        }

        if (lockIntervalRef.current) {
            clearInterval(lockIntervalRef.current);
            lockIntervalRef.current = null;
        }

        setState(s => ({
            ...s,
            connectionStatus: 'disconnected',
            connectionError: null,
            db: null,
            lockStatus: null,
        }));

        observer.emit('connection:disconnected', {
            config: state.activeConfigName,
        });
    }, [state.activeConfigName]);

    const reconnect = useCallback(async () => {

        await disconnect();
        await connect();
    }, [disconnect, connect]);

    // ─────────────────────────────────────────────────────────────
    // Lock Monitoring
    // ─────────────────────────────────────────────────────────────

    function startLockMonitoring(db: Kysely<any>, config: Config) {

        // Clear existing interval
        if (lockIntervalRef.current) {
            clearInterval(lockIntervalRef.current);
        }

        // Initial check
        checkLockStatus(db, config);

        // Poll every 30 seconds
        lockIntervalRef.current = setInterval(() => {

            checkLockStatus(db, config);
        }, 30_000);
    }

    async function checkLockStatus(db: Kysely<any>, config: Config) {

        setState(s => ({ ...s, lockLoading: true }));

        const lockMgr = new LockManager(db, config.connection.dialect, config.name);
        const [status] = await attempt(() => lockMgr.getStatus());

        setState(s => ({
            ...s,
            lockStatus: status ?? null,
            lockLoading: false,
        }));

        observer.emit('lock:status', {
            config: config.name,
            locked: !!status,
            holder: status?.lockedBy,
        });
    }

    const refreshLock = useCallback(async () => {

        if (!state.db || !state.activeConfig) {
            return;
        }

        await checkLockStatus(state.db, state.activeConfig);
    }, [state.db, state.activeConfig]);

    // ─────────────────────────────────────────────────────────────
    // State Management
    // ─────────────────────────────────────────────────────────────

    const refreshState = useCallback(async () => {

        if (!state.stateManager) {
            return;
        }

        // Reload from disk
        await state.stateManager.load();

        const configs = state.stateManager.listConfigs();
        const activeConfigName = state.stateManager.getActiveConfigName();
        const activeConfig = activeConfigName
            ? state.stateManager.getConfig(activeConfigName)
            : null;

        setState(s => ({
            ...s,
            configs,
            activeConfigName,
            activeConfig,
        }));

        observer.emit('state:refreshed', {
            configCount: configs.length,
            activeConfig: activeConfigName,
        });
    }, [state.stateManager]);

    const setActiveConfig = useCallback(async (name: string) => {

        if (!state.stateManager) {
            return;
        }

        await state.stateManager.setActiveConfig(name);

        const activeConfig = state.stateManager.getConfig(name);
        const configs = state.stateManager.listConfigs();

        setState(s => ({
            ...s,
            activeConfigName: name,
            activeConfig,
            configs,
        }));

        // Reconnect to new database
        if (activeConfig) {
            await disconnect();
            await connectToDatabase(activeConfig);
        }
    }, [state.stateManager, disconnect]);

    // ─────────────────────────────────────────────────────────────
    // Context Value
    // ─────────────────────────────────────────────────────────────

    const value: AppContextValue = {
        ...state,
        refreshState,
        setActiveConfig,
        connect,
        disconnect,
        reconnect,
        refreshLock,
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
}

export function useAppContext(): AppContextValue {

    const context = useContext(AppContext);

    if (!context) {
        throw new Error('useAppContext must be used within AppProvider');
    }

    return context;
}
```


## useApp Hook

```typescript
// src/cli/context/useApp.ts

import { useAppContext } from './AppContext';

/**
 * Main hook for accessing app state and actions.
 * Use this in screens to get the active config, connection status, etc.
 */
export function useApp() {

    const ctx = useAppContext();

    return {
        // Phase
        isInitializing: ctx.phase === 'initializing',
        isReady: ctx.phase === 'ready',
        isError: ctx.phase === 'error',
        phase: ctx.phase,
        error: ctx.error,

        // Config
        activeConfig: ctx.activeConfig,
        activeConfigName: ctx.activeConfigName,
        configs: ctx.configs,
        hasActiveConfig: !!ctx.activeConfig,
        setActiveConfig: ctx.setActiveConfig,
        refreshState: ctx.refreshState,

        // Connection
        connectionStatus: ctx.connectionStatus,
        connectionError: ctx.connectionError,
        isConnected: ctx.connectionStatus === 'connected',
        isConnecting: ctx.connectionStatus === 'connecting',
        isDisconnected: ctx.connectionStatus === 'disconnected',
        hasConnectionError: ctx.connectionStatus === 'error',
        db: ctx.db,
        connect: ctx.connect,
        disconnect: ctx.disconnect,
        reconnect: ctx.reconnect,

        // Lock
        lockStatus: ctx.lockStatus,
        lockLoading: ctx.lockLoading,
        isLocked: !!ctx.lockStatus,
        isLockedByMe: ctx.lockStatus?.lockedBy === getCurrentIdentity(),
        lockHolder: ctx.lockStatus?.lockedBy ?? null,
        refreshLock: ctx.refreshLock,
    };
}

function getCurrentIdentity(): string {

    const os = require('os');
    return `${process.env.USER || 'unknown'}@${os.hostname()}`;
}
```


## useConnection Hook

```typescript
// src/cli/context/useConnection.ts

import { useApp } from './useApp';

/**
 * Hook for components that need database access.
 * Provides the Kysely instance and connection state.
 */
export function useConnection() {

    const {
        db,
        connectionStatus,
        connectionError,
        isConnected,
        isConnecting,
        hasConnectionError,
        connect,
        disconnect,
        reconnect,
        activeConfigName,
    } = useApp();

    return {
        db,
        status: connectionStatus,
        error: connectionError,
        isConnected,
        isConnecting,
        hasError: hasConnectionError,
        configName: activeConfigName,

        // Actions
        connect,
        disconnect,
        reconnect,

        // Helper for guarded execution
        async execute<T>(fn: (db: Kysely<any>) => Promise<T>): Promise<T | null> {

            if (!db) {
                return null;
            }

            return fn(db);
        },
    };
}
```


## useLockStatus Hook

```typescript
// src/cli/context/useLockStatus.ts

import { useApp } from './useApp';

/**
 * Hook for components that need lock status.
 */
export function useLockStatus() {

    const {
        lockStatus,
        lockLoading,
        isLocked,
        isLockedByMe,
        lockHolder,
        refreshLock,
    } = useApp();

    return {
        status: lockStatus,
        loading: lockLoading,
        isLocked,
        isLockedByMe,
        isLockedByOther: isLocked && !isLockedByMe,
        holder: lockHolder,
        lockedAt: lockStatus?.lockedAt ?? null,
        reason: lockStatus?.reason ?? null,
        refresh: refreshLock,
    };
}
```


## Status Bar Component

```typescript
// src/cli/components/StatusBar.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { useApp } from '../context/useApp';

export interface StatusBarProps {
    showLock?: boolean;
}

export function StatusBar({ showLock = true }: StatusBarProps) {

    const {
        phase,
        activeConfigName,
        connectionStatus,
        isLocked,
        isLockedByMe,
        lockHolder,
    } = useApp();

    if (phase === 'initializing') {

        return (
            <Box justifyContent="flex-end">
                <Text color="gray">● initializing...</Text>
            </Box>
        );
    }

    return (
        <Box justifyContent="flex-end" gap={2}>

            {/* Config indicator */}
            {activeConfigName ? (
                <Text color="cyan" bold>{activeConfigName}</Text>
            ) : (
                <Text color="gray" italic>no config</Text>
            )}

            <Text color="gray">│</Text>

            {/* Connection indicator */}
            <ConnectionIndicator status={connectionStatus} />

            {/* Lock indicator */}
            {showLock && activeConfigName && (
                <>
                    <Text color="gray">│</Text>
                    <LockIndicator
                        isLocked={isLocked}
                        isLockedByMe={isLockedByMe}
                        lockHolder={lockHolder}
                    />
                </>
            )}

        </Box>
    );
}

interface ConnectionIndicatorProps {
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
}

function ConnectionIndicator({ status }: ConnectionIndicatorProps) {

    switch (status) {

        case 'connected':
            return (
                <Box>
                    <Text color="green">●</Text>
                    <Text color="gray"> connected</Text>
                </Box>
            );

        case 'connecting':
            return (
                <Box>
                    <Text color="yellow">◐</Text>
                    <Text color="gray"> connecting</Text>
                </Box>
            );

        case 'error':
            return (
                <Box>
                    <Text color="red">●</Text>
                    <Text color="red"> error</Text>
                </Box>
            );

        case 'disconnected':
        default:
            return (
                <Box>
                    <Text color="gray">○</Text>
                    <Text color="gray"> disconnected</Text>
                </Box>
            );
    }
}

interface LockIndicatorProps {
    isLocked: boolean;
    isLockedByMe: boolean;
    lockHolder: string | null;
}

function LockIndicator({ isLocked, isLockedByMe, lockHolder }: LockIndicatorProps) {

    if (!isLocked) {

        return (
            <Box>
                <Text color="green">🔓</Text>
                <Text color="gray"> free</Text>
            </Box>
        );
    }

    if (isLockedByMe) {

        return (
            <Box>
                <Text color="yellow">🔒</Text>
                <Text color="yellow"> you</Text>
            </Box>
        );
    }

    // Truncate holder name if too long
    const displayHolder = lockHolder && lockHolder.length > 10
        ? lockHolder.slice(0, 10) + '…'
        : lockHolder;

    return (
        <Box>
            <Text color="red">🔒</Text>
            <Text color="red"> {displayHolder}</Text>
        </Box>
    );
}
```


## Full Status Bar (Alternative)

A more detailed status bar for users who want more information:

```typescript
// src/cli/components/FullStatusBar.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { useApp } from '../context/useApp';
import { Badge } from './Badge';

export function FullStatusBar() {

    const {
        phase,
        activeConfigName,
        activeConfig,
        connectionStatus,
        connectionError,
        isLocked,
        isLockedByMe,
        lockHolder,
        lockStatus,
        configs,
    } = useApp();

    if (phase === 'initializing') {

        return (
            <Box
                borderStyle="single"
                borderColor="gray"
                paddingX={1}
            >
                <Text color="gray">Initializing...</Text>
            </Box>
        );
    }

    if (phase === 'error') {

        return (
            <Box
                borderStyle="single"
                borderColor="red"
                paddingX={1}
            >
                <Text color="red">Error: {useApp().error}</Text>
            </Box>
        );
    }

    return (
        <Box
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
            justifyContent="space-between"
        >

            {/* Left side: Config info */}
            <Box gap={2}>

                <Box>
                    <Text color="gray">Config: </Text>
                    {activeConfigName ? (
                        <Text color="cyan" bold>{activeConfigName}</Text>
                    ) : (
                        <Text color="yellow">none</Text>
                    )}
                </Box>

                {activeConfig && (
                    <Box>
                        <Text color="gray">({activeConfig.connection.dialect})</Text>
                    </Box>
                )}

                <Box>
                    <Text color="gray">[{configs.length} configs]</Text>
                </Box>

            </Box>

            {/* Right side: Status indicators */}
            <Box gap={2}>

                {/* Connection */}
                <Box>
                    {connectionStatus === 'connected' && (
                        <Badge label="CONNECTED" variant="success" />
                    )}
                    {connectionStatus === 'connecting' && (
                        <Badge label="CONNECTING" variant="warning" />
                    )}
                    {connectionStatus === 'error' && (
                        <Badge label="CONN ERROR" variant="error" />
                    )}
                    {connectionStatus === 'disconnected' && (
                        <Badge label="OFFLINE" variant="default" />
                    )}
                </Box>

                {/* Lock */}
                {activeConfigName && (
                    <Box>
                        {!isLocked && (
                            <Badge label="UNLOCKED" variant="success" />
                        )}
                        {isLocked && isLockedByMe && (
                            <Badge label="LOCKED (you)" variant="warning" />
                        )}
                        {isLocked && !isLockedByMe && (
                            <Badge label={`LOCKED (${lockHolder})`} variant="error" />
                        )}
                    </Box>
                )}

            </Box>

        </Box>
    );
}
```


## Updated App Shell

Update the main App shell to include the AppProvider and StatusBar:

```typescript
// src/cli/App.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { AppProvider } from './context/AppContext';
import { RouterProvider, useRouter } from './router';
import { StatusBar } from './components/StatusBar';
import { Header } from './components/Header';
import { GlobalKeyboard } from './keyboard/GlobalKeyboard';
import { ScreenRenderer } from './screens/ScreenRenderer';
import { useApp } from './context/useApp';

export interface AppProps {
    initialRoute?: string;
    projectRoot?: string;
}

export function App({ initialRoute, projectRoot }: AppProps) {

    return (
        <AppProvider projectRoot={projectRoot}>
            <RouterProvider initialRoute={initialRoute}>
                <GlobalKeyboard>
                    <AppContent />
                </GlobalKeyboard>
            </RouterProvider>
        </AppProvider>
    );
}

function AppContent() {

    const { phase, error, isInitializing } = useApp();

    if (isInitializing) {

        return (
            <Box flexDirection="column" padding={1}>
                <Text>Loading noorm...</Text>
            </Box>
        );
    }

    if (phase === 'error') {

        return (
            <Box flexDirection="column" padding={1}>
                <Text color="red">Failed to initialize: {error}</Text>
                <Text color="gray" marginTop={1}>
                    Run `noorm config:add` to create your first configuration.
                </Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">

            {/* Top bar: Title + Status */}
            <Box justifyContent="space-between" paddingX={1}>
                <Text bold>noorm</Text>
                <StatusBar />
            </Box>

            {/* Divider */}
            <Box>
                <Text color="gray">{'─'.repeat(process.stdout.columns || 80)}</Text>
            </Box>

            {/* Navigation tabs */}
            <Header />

            {/* Divider */}
            <Box>
                <Text color="gray">{'─'.repeat(process.stdout.columns || 80)}</Text>
            </Box>

            {/* Screen content */}
            <Box flexGrow={1} paddingX={1} paddingY={1}>
                <ScreenRenderer />
            </Box>

        </Box>
    );
}
```


## Screen Layout with Status Bar

```
┌─────────────────────────────────────────────────────────────────┐
│  noorm                              dev │ ● connected │ 🔓 free │
│─────────────────────────────────────────────────────────────────│
│  [Config]  Change   Run   DB   Lock                             │
│─────────────────────────────────────────────────────────────────│
│                                                                 │
│  ... screen content ...                                         │
│                                                                 │
│                                                                 │
│                                                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [c]config  [h]change  [r]run  [d]db  [l]lock  [?]help  [q]quit │
└─────────────────────────────────────────────────────────────────┘
```

Status indicators:

| Indicator | Meaning |
|-----------|---------|
| `● connected` (green) | Database connection active |
| `◐ connecting` (yellow) | Connection in progress |
| `● error` (red) | Connection failed |
| `○ disconnected` (gray) | No connection |
| `🔓 free` (green) | No lock held |
| `🔒 you` (yellow) | You hold the lock |
| `🔒 john@...` (red) | Another user holds lock |


## Simplified Screen Components

With AppContext, screens become simpler:

```typescript
// Before: Each screen loads its own state
function OldConfigListScreen() {
    const [loading, setLoading] = useState(true);
    const [configs, setConfigs] = useState([]);

    useEffect(() => {
        async function load() {
            const mgr = await getStateManager();
            await mgr.load();
            setConfigs(mgr.listConfigs());
            setLoading(false);
        }
        load();
    }, []);

    if (loading) return <Spinner />;
    // ...
}

// After: State is already loaded
function NewConfigListScreen() {
    const { configs, isReady } = useApp();

    if (!isReady) return <Spinner />;

    return (
        <SelectList
            items={configs.map(c => ({
                key: c.name,
                label: c.name,
                // ...
            }))}
        />
    );
}
```


## Connection Guard Component

For screens that require a database connection:

```typescript
// src/cli/components/ConnectionGuard.tsx

import React, { ReactNode } from 'react';
import { Box, Text } from 'ink';
import { useApp } from '../context/useApp';
import { Spinner, Alert } from './index';

interface ConnectionGuardProps {
    children: ReactNode;
    requireConnection?: boolean;
}

export function ConnectionGuard({
    children,
    requireConnection = true
}: ConnectionGuardProps) {

    const {
        hasActiveConfig,
        isConnecting,
        isConnected,
        hasConnectionError,
        connectionError,
        reconnect,
    } = useApp();

    if (!hasActiveConfig) {

        return (
            <Box flexDirection="column">
                <Alert variant="warning" title="No Active Config">
                    Select a configuration to continue.
                </Alert>
                <Text color="gray" marginTop={1}>
                    Press <Text bold>c</Text> to go to config.
                </Text>
            </Box>
        );
    }

    if (requireConnection) {

        if (isConnecting) {

            return <Spinner label="Connecting to database..." />;
        }

        if (hasConnectionError) {

            return (
                <Box flexDirection="column">
                    <Alert variant="error" title="Connection Error">
                        {connectionError}
                    </Alert>
                    <Text color="gray" marginTop={1}>
                        Press <Text bold>r</Text> to retry connection.
                    </Text>
                </Box>
            );
        }

        if (!isConnected) {

            return <Spinner label="Waiting for connection..." />;
        }
    }

    return <>{children}</>;
}
```


## Index Exports

```typescript
// src/cli/context/index.ts

export { AppProvider, useAppContext } from './AppContext';
export { useApp } from './useApp';
export { useConnection } from './useConnection';
export { useLockStatus } from './useLockStatus';
export * from './types';
```


## Observer Events

```typescript
// App lifecycle events
observer.emit('app:initializing', {});
observer.emit('app:ready', { configCount: number, activeConfig: string | null });
observer.emit('app:error', { error: string });

// Connection events (in addition to existing)
observer.emit('connection:connecting', { config: string });
observer.emit('connection:connected', { config: string });
observer.emit('connection:disconnected', { config: string });

// State events
observer.emit('state:refreshed', { configCount: number, activeConfig: string | null });
```


## Headless Mode Integration

The AppContext integrates with headless mode by emitting all state changes as observer events, which the headless logger can capture:

```typescript
// src/cli/headless/logger.ts

import { observer } from '@logosdx/observer';

export function setupHeadlessLogging() {

    observer.subscribe('app:initializing', () => {
        console.log('[noorm] Initializing...');
    });

    observer.subscribe('app:ready', (data) => {
        console.log(`[noorm] Ready. ${data.configCount} configs, active: ${data.activeConfig || 'none'}`);
    });

    observer.subscribe('connection:connecting', (data) => {
        console.log(`[noorm] Connecting to ${data.config}...`);
    });

    observer.subscribe('connection:connected', (data) => {
        console.log(`[noorm] Connected to ${data.config}`);
    });

    observer.subscribe('connection:error', (data) => {
        console.error(`[noorm] Connection error: ${data.error}`);
    });

    observer.subscribe('lock:status', (data) => {
        if (data.locked) {
            console.log(`[noorm] Lock held by ${data.holder}`);
        }
    });
}
```


## Testing

```typescript
import React from 'react';
import { render } from 'ink-testing-library';
import { AppProvider } from './AppContext';
import { useApp } from './useApp';

function TestComponent() {
    const { phase, configs, connectionStatus } = useApp();
    return (
        <Box>
            <Text>Phase: {phase}</Text>
            <Text>Configs: {configs.length}</Text>
            <Text>Connection: {connectionStatus}</Text>
        </Box>
    );
}

describe('AppContext', () => {

    it('should initialize and load state', async () => {

        const { lastFrame } = render(
            <AppProvider>
                <TestComponent />
            </AppProvider>
        );

        // Initially initializing
        expect(lastFrame()).toContain('Phase: initializing');

        // Wait for load
        await new Promise(r => setTimeout(r, 100));

        expect(lastFrame()).toContain('Phase: ready');
    });

    it('should auto-connect when active config exists', async () => {

        // Mock state with active config
        const { lastFrame } = render(
            <AppProvider>
                <TestComponent />
            </AppProvider>
        );

        await new Promise(r => setTimeout(r, 200));

        expect(lastFrame()).toContain('Connection: connected');
    });
});

describe('StatusBar', () => {

    it('should show connection status', async () => {

        const { lastFrame } = render(
            <AppProvider>
                <StatusBar />
            </AppProvider>
        );

        await new Promise(r => setTimeout(r, 200));

        expect(lastFrame()).toContain('connected');
    });

    it('should show lock status', async () => {

        const { lastFrame } = render(
            <AppProvider>
                <StatusBar showLock />
            </AppProvider>
        );

        await new Promise(r => setTimeout(r, 200));

        expect(lastFrame()).toMatch(/🔓|🔒/);
    });
});
```
