/**
 * CLI type definitions for the noorm terminal interface.
 *
 * Defines routes, navigation state, keyboard handling, and mode detection
 * for both TUI and headless operation.
 */


/**
 * All valid route identifiers.
 *
 * Routes follow a hierarchical `section` or `section/action` pattern.
 * This union provides compile-time safety for navigation.
 */
export type Route =
    // Home
    | 'home'
    // Config management
    | 'config'
    | 'config/add'
    | 'config/edit'
    | 'config/rm'
    | 'config/cp'
    | 'config/use'
    | 'config/validate'
    | 'config/export'
    | 'config/import'
    // Secret management
    | 'secret'
    | 'secret/set'
    | 'secret/rm'
    // Settings
    | 'settings'
    | 'settings/edit'
    | 'settings/init'
    // Changesets
    | 'change'
    | 'change/add'
    | 'change/edit'
    | 'change/rm'
    | 'change/run'
    | 'change/revert'
    | 'change/rewind'
    | 'change/next'
    | 'change/ff'
    // Run operations
    | 'run'
    | 'run/list'
    | 'run/build'
    | 'run/exec'
    | 'run/file'
    | 'run/dir'
    // Database lifecycle
    | 'db'
    | 'db/create'
    | 'db/destroy'
    // Lock management
    | 'lock'
    | 'lock/status'
    | 'lock/acquire'
    | 'lock/release'
    | 'lock/force'
    // Identity
    | 'identity'
    | 'identity/init'
    | 'identity/export'
    | 'identity/list'
    // Init (first run)
    | 'init'


/**
 * Route parameters that can be passed during navigation.
 *
 * Different routes use different subsets of these params:
 * - `name`: Config name, changeset name, secret key
 * - `count`: Numeric parameter (e.g., change/next 5)
 * - `path`: File or directory path
 */
export interface RouteParams {

    /** Named entity (config, changeset, secret key) */
    name?: string

    /** Numeric parameter (count for next/rewind) */
    count?: number

    /** File or directory path */
    path?: string
}


/**
 * Navigation history entry.
 *
 * Stores both the route and its params to enable back navigation
 * with full state restoration.
 */
export interface HistoryEntry {

    route: Route
    params: RouteParams
}


/**
 * Router state managed by RouterProvider.
 */
export interface RouterState {

    /** Current active route */
    route: Route

    /** Parameters for current route */
    params: RouteParams

    /** Navigation history stack */
    history: HistoryEntry[]
}


/**
 * Router context value exposed to components.
 */
export interface RouterContextValue extends RouterState {

    /**
     * Navigate to a new route, pushing current to history.
     *
     * @example
     * ```typescript
     * navigate('config/edit', { name: 'production' })
     * ```
     */
    navigate: (route: Route, params?: RouteParams) => void

    /**
     * Go back to previous route in history.
     * Does nothing if at root (no history).
     */
    back: () => void

    /**
     * Replace current route without adding to history.
     * Useful for redirects.
     */
    replace: (route: Route, params?: RouteParams) => void

    /**
     * Clear history and return to home.
     */
    reset: () => void

    /**
     * Whether back navigation is possible.
     */
    canGoBack: boolean

    /**
     * Get the section from current route (e.g., 'config' from 'config/add').
     */
    section: string
}


/**
 * Focus stack entry for keyboard input management.
 *
 * Components push onto the focus stack when they need exclusive
 * keyboard input (e.g., modals, text inputs).
 */
export interface FocusEntry {

    /** Unique identifier for this focus claim */
    id: string

    /** Optional debug label */
    label?: string
}


/**
 * Focus context value for keyboard input management.
 */
export interface FocusContextValue {

    /**
     * Claim focus for this component.
     * Only the top of the stack receives keyboard input.
     */
    push: (id: string, label?: string) => void

    /**
     * Release focus for this component.
     * Must match the ID that was pushed.
     */
    pop: (id: string) => void

    /**
     * Check if this component currently has focus.
     */
    isActive: (id: string) => boolean

    /**
     * Get the ID of the currently focused component.
     */
    activeId: string | null

    /**
     * Debug: get the full focus stack.
     */
    stack: FocusEntry[]
}


/**
 * Key event from Ink's useInput hook.
 */
export interface KeyEvent {

    upArrow: boolean
    downArrow: boolean
    leftArrow: boolean
    rightArrow: boolean
    return: boolean
    escape: boolean
    ctrl: boolean
    shift: boolean
    meta: boolean
    tab: boolean
    backspace: boolean
    delete: boolean
    pageUp: boolean
    pageDown: boolean
}


/**
 * Keyboard handler function signature.
 */
export type KeyHandler = (input: string, key: KeyEvent) => void | boolean


/**
 * CLI execution mode.
 */
export type CliMode = 'tui' | 'headless'


/**
 * CLI flags parsed from command line.
 */
export interface CliFlags {

    /** Force headless mode */
    headless: boolean

    /** Output JSON in headless mode */
    json: boolean

    /** Skip confirmations */
    yes: boolean

    /** Use specific config */
    config?: string

    /** Force operation */
    force: boolean

    /** Preview without executing */
    dryRun: boolean
}


/**
 * Parsed CLI input ready for routing.
 */
export interface ParsedCli {

    /** Determined execution mode */
    mode: CliMode

    /** Initial route to navigate to */
    route: Route

    /** Route parameters from CLI args */
    params: RouteParams

    /** Parsed flags */
    flags: CliFlags
}


/**
 * Screen component props.
 *
 * All screen components receive route params and can use
 * hooks to access router, focus, etc.
 */
export interface ScreenProps {

    params: RouteParams
}


/**
 * Screen registry entry.
 */
export interface ScreenEntry {

    /** React component to render */
    component: React.ComponentType<ScreenProps>

    /** Optional label for breadcrumb */
    label?: string
}


/**
 * Help entry for keyboard shortcuts overlay.
 */
export interface HelpEntry {

    /** Key or key combination (e.g., 'Esc', 'Ctrl+C') */
    key: string

    /** Description of action */
    description: string
}


/**
 * Screen sections for navigation grouping.
 */
export type Section =
    | 'home'
    | 'config'
    | 'secret'
    | 'settings'
    | 'change'
    | 'run'
    | 'db'
    | 'lock'
    | 'identity'
    | 'init'


/**
 * Extract section from a route.
 *
 * @example
 * ```typescript
 * getSection('config/add') // 'config'
 * getSection('home') // 'home'
 * ```
 */
export function getSection(route: Route): Section {

    const parts = route.split('/')
    return parts[0] as Section
}


/**
 * Get parent route for hierarchical navigation.
 *
 * @example
 * ```typescript
 * getParentRoute('config/add') // 'config'
 * getParentRoute('config') // 'home'
 * getParentRoute('home') // null
 * ```
 */
export function getParentRoute(route: Route): Route | null {

    if (route === 'home') {

        return null
    }

    const parts = route.split('/')

    if (parts.length === 1) {

        return 'home'
    }

    return parts.slice(0, -1).join('/') as Route
}
