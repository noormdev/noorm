/**
 * Screen registry tests.
 *
 * Tests screen lookup, labels, and rendering.
 */
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { Text } from 'ink'

import { RouterProvider } from '../../src/cli/router.js'
import { FocusProvider } from '../../src/cli/focus.js'
import {
    getScreen,
    getRouteLabel,
    getRegisteredRoutes,
    isRouteRegistered,
    registerScreen,
    ScreenRenderer,
} from '../../src/cli/screens.js'
import type { ScreenProps, Route } from '../../src/cli/types.js'


/**
 * Full context wrapper for screen tests.
 */
function TestWrapper({ initialRoute, children }: { initialRoute?: Route; children: React.ReactNode }) {

    return (
        <FocusProvider>
            <RouterProvider initialRoute={initialRoute}>
                {children}
            </RouterProvider>
        </FocusProvider>
    )
}


describe('cli: screens', () => {

    describe('getScreen', () => {

        it('should return screen entry for registered route', () => {

            const screen = getScreen('home')

            expect(screen).toBeDefined()
            expect(screen?.component).toBeDefined()
            expect(screen?.label).toBe('Home')
        })

        it('should return undefined for unregistered route', () => {

            const screen = getScreen('lock/acquire')

            expect(screen).toBeUndefined()
        })
    })

    describe('getRouteLabel', () => {

        it('should return label for registered route', () => {

            expect(getRouteLabel('home')).toBe('Home')
        })

        it('should generate label from route for unregistered route', () => {

            expect(getRouteLabel('db')).toBe('Db')
            expect(getRouteLabel('settings')).toBe('Settings')
        })

        it('should use label from registered route or last part of nested route', () => {

            // Registered routes use their configured labels
            expect(getRouteLabel('config/add')).toBe('Add Config')
            expect(getRouteLabel('config/edit')).toBe('Edit Config')
            expect(getRouteLabel('change/revert')).toBe('Revert Changeset')
            // Unregistered routes generate labels from last path segment
            expect(getRouteLabel('run/build')).toBe('Build')
            expect(getRouteLabel('secret/set')).toBe('Set')
        })

        it('should capitalize first letter', () => {

            expect(getRouteLabel('db')).toBe('Db')
            expect(getRouteLabel('lock/status')).toBe('Status')
        })
    })

    describe('getRegisteredRoutes', () => {

        it('should return array of registered routes', () => {

            const routes = getRegisteredRoutes()

            expect(Array.isArray(routes)).toBe(true)
            expect(routes).toContain('home')
        })
    })

    describe('isRouteRegistered', () => {

        it('should return true for registered route', () => {

            expect(isRouteRegistered('home')).toBe(true)
        })

        it('should return false for unregistered route', () => {

            expect(isRouteRegistered('lock/acquire')).toBe(false)
        })
    })

    describe('registerScreen', () => {

        it('should register a new screen', () => {

            function TestScreen({ params }: ScreenProps) {

                return <Text>Test Screen: {params.name ?? 'none'}</Text>
            }

            // Use an unregistered route for testing
            registerScreen('db/create', {
                component: TestScreen,
                label: 'Create Database',
            })

            expect(isRouteRegistered('db/create')).toBe(true)
            expect(getRouteLabel('db/create')).toBe('Create Database')
            expect(getScreen('db/create')?.component).toBe(TestScreen)
        })
    })

    describe('ScreenRenderer', () => {

        it('should render home screen by default', () => {

            const { lastFrame } = render(
                <TestWrapper initialRoute="home">
                    <ScreenRenderer />
                </TestWrapper>
            )

            // Home screen should render something
            expect(lastFrame()).toBeDefined()
        })

        it('should render NotFoundScreen for unregistered route', () => {

            const { lastFrame } = render(
                <TestWrapper initialRoute="lock/acquire">
                    <ScreenRenderer />
                </TestWrapper>
            )

            expect(lastFrame()).toContain('Not Found')
            expect(lastFrame()).toContain('lock/acquire')
        })

        it('should pass params to screen component', () => {

            function ParamScreen({ params }: ScreenProps) {

                return <Text>name:{params.name ?? 'none'}|path:{params.path ?? 'none'}</Text>
            }

            registerScreen('secret/set', {
                component: ParamScreen,
                label: 'Set Secret',
            })

            const { lastFrame } = render(
                <FocusProvider>
                    <RouterProvider
                        initialRoute="secret/set"
                        initialParams={{ name: 'API_KEY', path: '/path/to/file' }}
                    >
                        <ScreenRenderer />
                    </RouterProvider>
                </FocusProvider>
            )

            expect(lastFrame()).toContain('name:API_KEY')
            expect(lastFrame()).toContain('path:/path/to/file')
        })

        it('should render different screens based on route', () => {

            function ScreenA() {

                return <Text>Screen A</Text>
            }

            function ScreenB() {

                return <Text>Screen B</Text>
            }

            registerScreen('identity', {
                component: ScreenA,
                label: 'Screen A',
            })

            registerScreen('identity/init', {
                component: ScreenB,
                label: 'Screen B',
            })

            // Test that each route renders the correct screen
            const { lastFrame: frameA, unmount: unmountA } = render(
                <TestWrapper initialRoute="identity">
                    <ScreenRenderer />
                </TestWrapper>
            )
            expect(frameA()).toContain('Screen A')
            unmountA()

            const { lastFrame: frameB, unmount: unmountB } = render(
                <TestWrapper initialRoute="identity/init">
                    <ScreenRenderer />
                </TestWrapper>
            )
            expect(frameB()).toContain('Screen B')
            unmountB()
        })
    })
})
