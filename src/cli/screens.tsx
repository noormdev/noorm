/**
 * Screen registry maps routes to React components.
 *
 * When adding new screens:
 * 1. Create the screen component in src/cli/screens/
 * 2. Import it here
 * 3. Add it to the SCREENS registry
 *
 * @example
 * ```typescript
 * // In screens/config/add.tsx
 * export function ConfigAddScreen({ params }: ScreenProps) { ... }
 *
 * // In this file
 * import { ConfigAddScreen } from './screens/config/add.js'
 *
 * const SCREENS: ScreenRegistry = {
 *     'config/add': { component: ConfigAddScreen, label: 'Add Config' },
 *     // ...
 * }
 * ```
 */
import { Suspense } from 'react'
import type { ReactElement } from 'react'
import { Box, Text } from 'ink'

import type { Route, ScreenProps, ScreenEntry } from './types.js'
import { useRouter } from './router.js'

// Placeholder screens until real implementations
import { HomeScreen } from './screens/home.js'
import { NotFoundScreen } from './screens/not-found.js'
import { InitScreen } from './screens/init/index.js'
import {
    ConfigListScreen,
    ConfigAddScreen,
    ConfigEditScreen,
    ConfigRemoveScreen,
    ConfigCopyScreen,
    ConfigUseScreen,
    ConfigValidateScreen,
    ConfigExportScreen,
    ConfigImportScreen,
} from './screens/config/index.js'
import {
    ChangeListScreen,
    ChangeAddScreen,
    ChangeEditScreen,
    ChangeRemoveScreen,
    ChangeRunScreen,
    ChangeRevertScreen,
    ChangeNextScreen,
    ChangeFFScreen,
    ChangeRewindScreen,
} from './screens/change/index.js'


/**
 * Screen registry type.
 */
export type ScreenRegistry = Partial<Record<Route, ScreenEntry>>


/**
 * Registry of all available screens.
 *
 * Routes without entries will render NotFoundScreen.
 * Add new screens here as they are implemented.
 */
const SCREENS: ScreenRegistry = {

    // Home
    'home': {
        component: HomeScreen,
        label: 'Home'
    },

    // Init
    'init': {
        component: InitScreen,
        label: 'Initialize'
    },

    // Config
    'config': {
        component: ConfigListScreen,
        label: 'Configurations'
    },
    'config/add': {
        component: ConfigAddScreen,
        label: 'Add Config'
    },
    'config/edit': {
        component: ConfigEditScreen,
        label: 'Edit Config'
    },
    'config/rm': {
        component: ConfigRemoveScreen,
        label: 'Delete Config'
    },
    'config/cp': {
        component: ConfigCopyScreen,
        label: 'Copy Config'
    },
    'config/use': {
        component: ConfigUseScreen,
        label: 'Use Config'
    },
    'config/validate': {
        component: ConfigValidateScreen,
        label: 'Validate Config'
    },
    'config/export': {
        component: ConfigExportScreen,
        label: 'Export Config'
    },
    'config/import': {
        component: ConfigImportScreen,
        label: 'Import Config'
    },

    // Change
    'change': {
        component: ChangeListScreen,
        label: 'Changesets'
    },
    'change/add': {
        component: ChangeAddScreen,
        label: 'Add Changeset'
    },
    'change/edit': {
        component: ChangeEditScreen,
        label: 'Edit Changeset'
    },
    'change/rm': {
        component: ChangeRemoveScreen,
        label: 'Delete Changeset'
    },
    'change/run': {
        component: ChangeRunScreen,
        label: 'Run Changeset'
    },
    'change/revert': {
        component: ChangeRevertScreen,
        label: 'Revert Changeset'
    },
    'change/next': {
        component: ChangeNextScreen,
        label: 'Apply Next'
    },
    'change/ff': {
        component: ChangeFFScreen,
        label: 'Fast-Forward'
    },
    'change/rewind': {
        component: ChangeRewindScreen,
        label: 'Rewind'
    },
}


/**
 * Loading fallback for lazy-loaded screens.
 */
function ScreenLoading(): ReactElement {

    return (
        <Box>
            <Text dimColor>Loading...</Text>
        </Box>
    )
}


/**
 * Get a screen entry for a route.
 *
 * Returns the screen config if registered, or undefined for unknown routes.
 */
export function getScreen(route: Route): ScreenEntry | undefined {

    return SCREENS[route]
}


/**
 * Get the label for a route (for breadcrumbs, titles).
 */
export function getRouteLabel(route: Route): string {

    const screen = SCREENS[route]

    if (screen?.label) {

        return screen.label
    }

    // Generate label from route
    const parts = route.split('/')
    const lastPart = parts[parts.length - 1] ?? route

    // Capitalize first letter
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1)
}


/**
 * Screen renderer component.
 *
 * Looks up the screen for the current route and renders it.
 * Falls back to NotFoundScreen for unknown routes.
 *
 * @example
 * ```tsx
 * <RouterProvider>
 *     <ScreenRenderer />
 * </RouterProvider>
 * ```
 */
export function ScreenRenderer(): ReactElement {

    const { route, params } = useRouter()

    const entry = SCREENS[route]

    if (!entry) {

        return <NotFoundScreen params={params} />
    }

    const Screen = entry.component

    return (
        <Suspense fallback={<ScreenLoading />}>
            <Screen params={params} />
        </Suspense>
    )
}


/**
 * Get all registered routes.
 *
 * Useful for testing and documentation.
 */
export function getRegisteredRoutes(): Route[] {

    return Object.keys(SCREENS) as Route[]
}


/**
 * Check if a route is registered.
 */
export function isRouteRegistered(route: Route): boolean {

    return route in SCREENS
}


/**
 * Register a screen at runtime.
 *
 * Mainly useful for testing. In production, prefer static registration.
 */
export function registerScreen(route: Route, entry: ScreenEntry): void {

    SCREENS[route] = entry
}
