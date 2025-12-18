/**
 * Router context and provider for screen navigation.
 *
 * Manages navigation state with history support for back navigation.
 * The router is the foundation of the CLI's screen-based UI.
 *
 * @example
 * ```typescript
 * // In a screen component
 * const { navigate, back, canGoBack } = useRouter()
 *
 * // Navigate to a new screen
 * navigate('config/edit', { name: 'production' })
 *
 * // Go back
 * if (canGoBack) back()
 * ```
 */
import {
    createContext,
    useContext,
    useState,
    useCallback,
    useMemo
} from 'react'

import type { ReactNode, ReactElement } from 'react'

import {
    type Route,
    type RouteParams,
    type HistoryEntry,
    type RouterContextValue,
    getSection
} from './types.js'


const RouterContext = createContext<RouterContextValue | null>(null)


/**
 * Props for RouterProvider.
 */
export interface RouterProviderProps {

    /** Initial route to display */
    initialRoute?: Route

    /** Initial route parameters */
    initialParams?: RouteParams

    /** Child components */
    children: ReactNode
}


/**
 * Router provider component.
 *
 * Wrap your app with this to enable navigation.
 *
 * @example
 * ```tsx
 * <RouterProvider initialRoute="home">
 *     <App />
 * </RouterProvider>
 * ```
 */
export function RouterProvider({
    initialRoute = 'home',
    initialParams = {},
    children
}: RouterProviderProps): ReactElement {

    const [route, setRoute] = useState<Route>(initialRoute)
    const [params, setParams] = useState<RouteParams>(initialParams)
    const [history, setHistory] = useState<HistoryEntry[]>([])

    const navigate = useCallback((newRoute: Route, newParams: RouteParams = {}) => {

        // Push current state to history
        setHistory(prev => [...prev, { route, params }])

        // Navigate to new route
        setRoute(newRoute)
        setParams(newParams)
    }, [route, params])

    const back = useCallback(() => {

        if (history.length === 0) {

            return
        }

        // Pop the last entry from history
        const previous = history[history.length - 1]!

        setHistory(prev => prev.slice(0, -1))
        setRoute(previous.route)
        setParams(previous.params)
    }, [history])

    const replace = useCallback((newRoute: Route, newParams: RouteParams = {}) => {

        // Replace without modifying history
        setRoute(newRoute)
        setParams(newParams)
    }, [])

    const reset = useCallback(() => {

        setHistory([])
        setRoute('home')
        setParams({})
    }, [])

    const value = useMemo<RouterContextValue>(() => ({
        route,
        params,
        history,
        navigate,
        back,
        replace,
        reset,
        canGoBack: history.length > 0,
        section: getSection(route)
    }), [route, params, history, navigate, back, replace, reset])

    return (
        <RouterContext.Provider value={value}>
            {children}
        </RouterContext.Provider>
    )
}


/**
 * Hook to access router functionality.
 *
 * Must be used within a RouterProvider.
 *
 * @example
 * ```typescript
 * const { route, navigate, back } = useRouter()
 *
 * // Check current route
 * if (route === 'home') { ... }
 *
 * // Navigate with params
 * navigate('config/edit', { name: 'dev' })
 * ```
 */
export function useRouter(): RouterContextValue {

    const context = useContext(RouterContext)

    if (!context) {

        throw new Error('useRouter must be used within a RouterProvider')
    }

    return context
}


/**
 * Hook to get just the current route and params.
 *
 * Useful when you only need to read route state.
 */
export function useRoute(): { route: Route; params: RouteParams; section: string } {

    const { route, params, section } = useRouter()

    return { route, params, section }
}


/**
 * Hook to get navigation functions only.
 *
 * Useful when you only need to navigate without reading state.
 */
export function useNavigation(): Pick<RouterContextValue, 'navigate' | 'back' | 'replace' | 'reset' | 'canGoBack'> {

    const { navigate, back, replace, reset, canGoBack } = useRouter()

    return { navigate, back, replace, reset, canGoBack }
}
