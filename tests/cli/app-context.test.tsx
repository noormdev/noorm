/**
 * App Context tests.
 *
 * Tests the AppContextProvider, hooks, and guard components.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { Text } from 'ink'

import {
    AppContextProvider,
    useAppContext,
    useLoadingStatus,
    useActiveConfig,
    useConnectionStatus,
    useLockStatus,
    useIdentity,
    useSettings,
    LoadingGuard,
    ConfigGuard,
    IdentityGuard,
} from '../../src/cli/app-context.js'
import { observer } from '../../src/core/index.js'


// Create mock managers for testing
const createMockStateManager = () => ({

    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(null),
    getActiveConfigName: vi.fn().mockReturnValue(null),
    listConfigs: vi.fn().mockReturnValue([]),
    getIdentity: vi.fn().mockReturnValue(null),
    getConfig: vi.fn().mockReturnValue(null),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
})

const createMockSettingsManager = () => ({

    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
})


// Mock the state and settings managers
vi.mock('../../src/core/index.js', async () => {

    const actual = await vi.importActual('../../src/core/index.js')

    return {
        ...actual,
        getStateManager: vi.fn(() => createMockStateManager()),
        getSettingsManager: vi.fn(() => createMockSettingsManager()),
        resetStateManager: vi.fn(),
        resetSettingsManager: vi.fn(),
    }
})


/**
 * Test component that displays context state.
 */
function ContextDisplay() {

    const ctx = useAppContext()

    return (
        <Text>
            status:{ctx.loadingStatus}|
            configName:{ctx.activeConfigName ?? 'null'}|
            hasIdentity:{String(ctx.hasIdentity)}|
            connection:{ctx.connectionStatus}|
            lock:{ctx.lockStatus.status}
        </Text>
    )
}


/**
 * Test component for loading status hook.
 */
function LoadingStatusDisplay() {

    const { loadingStatus, error } = useLoadingStatus()

    return <Text>loading:{loadingStatus}|error:{error?.message ?? 'null'}</Text>
}


/**
 * Test component for active config hook.
 */
function ActiveConfigDisplay() {

    const { activeConfig, activeConfigName, configs } = useActiveConfig()

    return (
        <Text>
            name:{activeConfigName ?? 'null'}|
            hasConfig:{String(!!activeConfig)}|
            count:{configs.length}
        </Text>
    )
}


/**
 * Test component for connection status hook.
 */
function ConnectionStatusDisplay() {

    const { connectionStatus, connectedConfig } = useConnectionStatus()

    return (
        <Text>
            status:{connectionStatus}|
            config:{connectedConfig ?? 'null'}
        </Text>
    )
}


/**
 * Test component for lock status hook.
 */
function LockStatusDisplay() {

    const { lockStatus } = useLockStatus()

    return (
        <Text>
            status:{lockStatus.status}|
            holder:{lockStatus.holder ?? 'null'}
        </Text>
    )
}


/**
 * Test component for identity hook.
 */
function IdentityDisplay() {

    const { identity, hasIdentity } = useIdentity()

    return (
        <Text>
            hasIdentity:{String(hasIdentity)}|
            name:{identity?.name ?? 'null'}
        </Text>
    )
}


/**
 * Test component for settings hook.
 */
function SettingsDisplay() {

    const { settings, settingsManager } = useSettings()

    return (
        <Text>
            hasSettings:{String(!!settings)}|
            hasManager:{String(!!settingsManager)}
        </Text>
    )
}


describe('cli: app-context', () => {

    beforeEach(() => {

        vi.clearAllMocks()
    })

    describe('AppContextProvider', () => {

        it('should render children', () => {

            const { lastFrame } = render(
                <AppContextProvider autoLoad={false}>
                    <Text>Hello World</Text>
                </AppContextProvider>
            )

            expect(lastFrame()).toContain('Hello World')
        })

        it('should start with not-initialized status when autoLoad is false', () => {

            const { lastFrame } = render(
                <AppContextProvider autoLoad={false}>
                    <LoadingStatusDisplay />
                </AppContextProvider>
            )

            expect(lastFrame()).toContain('loading:not-initialized')
        })

        it('should auto-load on mount by default', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <LoadingStatusDisplay />
                </AppContextProvider>
            )

            // Wait for load to complete
            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('loading:ready')
        })
    })

    describe('useAppContext', () => {

        it('should throw when used outside AppContextProvider', () => {

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

            const { lastFrame } = render(<ContextDisplay />)
            const output = lastFrame() ?? ''

            expect(output).toContain('useAppContext must be used within an AppContextProvider')

            errorSpy.mockRestore()
        })

        it('should provide context value inside provider', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <ContextDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('status:ready')
            expect(lastFrame()).toContain('configName:null')
            expect(lastFrame()).toContain('hasIdentity:false')
            expect(lastFrame()).toContain('connection:disconnected')
            expect(lastFrame()).toContain('lock:free')
        })
    })

    describe('useLoadingStatus', () => {

        it('should return loading status and error', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <LoadingStatusDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('loading:ready')
            expect(lastFrame()).toContain('error:null')
        })
    })

    describe('useActiveConfig', () => {

        it('should return active config info', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <ActiveConfigDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('name:null')
            expect(lastFrame()).toContain('hasConfig:false')
            expect(lastFrame()).toContain('count:0')
        })
    })

    describe('useConnectionStatus', () => {

        it('should return connection status', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <ConnectionStatusDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('status:disconnected')
            expect(lastFrame()).toContain('config:null')
        })

        it('should update on connection:open event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <ConnectionStatusDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            // Emit connection open event
            observer.emit('connection:open', {
                configName: 'dev',
                dialect: 'postgres',
            })

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('status:connected')
            expect(lastFrame()).toContain('config:dev')

            unmount()
        })

        it('should update on connection:close event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <ConnectionStatusDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            // Open then close
            observer.emit('connection:open', { configName: 'dev', dialect: 'postgres' })
            await new Promise(resolve => setTimeout(resolve, 50))

            observer.emit('connection:close', { configName: 'dev' })
            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('status:disconnected')
            expect(lastFrame()).toContain('config:null')

            unmount()
        })
    })

    describe('useLockStatus', () => {

        it('should return lock status', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <LockStatusDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('status:free')
            expect(lastFrame()).toContain('holder:null')
        })

        it('should update on lock:acquired event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LockStatusDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            observer.emit('lock:acquired', {
                configName: 'dev',
                identity: 'alice@example.com',
                expiresAt: new Date(Date.now() + 60000),
            })

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('status:locked')
            expect(lastFrame()).toContain('holder:alice@example.com')

            unmount()
        })

        it('should update on lock:released event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LockStatusDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            // Acquire then release
            observer.emit('lock:acquired', {
                configName: 'dev',
                identity: 'alice@example.com',
                expiresAt: new Date(Date.now() + 60000),
            })
            await new Promise(resolve => setTimeout(resolve, 50))

            observer.emit('lock:released', {
                configName: 'dev',
                identity: 'alice@example.com',
            })
            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('status:free')

            unmount()
        })

        it('should update on lock:blocked event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LockStatusDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            observer.emit('lock:blocked', {
                configName: 'dev',
                holder: 'bob@example.com',
                heldSince: new Date(),
            })

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('status:blocked')
            expect(lastFrame()).toContain('holder:bob@example.com')

            unmount()
        })
    })

    describe('useIdentity', () => {

        it('should return identity info', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <IdentityDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('hasIdentity:false')
            expect(lastFrame()).toContain('name:null')
        })
    })

    describe('useSettings', () => {

        it('should return settings info', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <SettingsDisplay />
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('hasSettings:true')
            expect(lastFrame()).toContain('hasManager:true')
        })
    })

    describe('LoadingGuard', () => {

        it('should show loading content while loading', () => {

            const { lastFrame } = render(
                <AppContextProvider autoLoad={false}>
                    <LoadingGuard loading={<Text>Loading...</Text>}>
                        <Text>Content</Text>
                    </LoadingGuard>
                </AppContextProvider>
            )

            expect(lastFrame()).toContain('Loading...')
        })

        it('should show children when ready', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <LoadingGuard loading={<Text>Loading...</Text>}>
                        <Text>Content</Text>
                    </LoadingGuard>
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('Content')
        })
    })

    describe('ConfigGuard', () => {

        it('should show fallback when no config is selected', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <ConfigGuard fallback={<Text>No config</Text>}>
                        <Text>Has config</Text>
                    </ConfigGuard>
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('No config')
        })
    })

    describe('IdentityGuard', () => {

        it('should show fallback when no identity is set', async () => {

            const { lastFrame } = render(
                <AppContextProvider>
                    <IdentityGuard fallback={<Text>No identity</Text>}>
                        <Text>Has identity</Text>
                    </IdentityGuard>
                </AppContextProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('No identity')
        })
    })
})
