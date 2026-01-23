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
    // Changes
    | 'change'
    | 'change/add'
    | 'change/edit'
    | 'change/ff'
    | 'change/history'
    | 'change/history/detail'
    | 'change/next'
    | 'change/revert'
    | 'change/rewind'
    | 'change/rm'
    | 'change/run'

    // Config management
    | 'config'
    | 'config/add'
    | 'config/cp'
    | 'config/edit'
    | 'config/export'
    | 'config/import'
    | 'config/rm'
    | 'config/use'
    | 'config/validate'

    // Database lifecycle
    | 'db'
    | 'db/create'
    | 'db/destroy'
    | 'db/teardown'
    | 'db/truncate'

    // Database exploration
    | 'db/explore'
    | 'db/explore/fks'
    | 'db/explore/functions'
    | 'db/explore/functions/detail'
    | 'db/explore/indexes'
    | 'db/explore/procedures'
    | 'db/explore/procedures/detail'
    | 'db/explore/tables'
    | 'db/explore/tables/detail'
    | 'db/explore/types'
    | 'db/explore/types/detail'
    | 'db/explore/views'
    | 'db/explore/views/detail'

    // SQL Terminal
    | 'db/sql'
    | 'db/sql/clear'
    | 'db/sql/history'

    // Debug (hidden easter egg)
    | 'debug'
    | 'debug/table'
    | 'debug/table/detail'

    // Home & Help
    | 'help'
    | 'home'


    // Identity
    | 'identity'
    | 'identity/edit'
    | 'identity/export'
    | 'identity/init'
    | 'identity/list'

    // Init (first run)
    | 'init'

    // Lock management
    | 'lock'
    | 'lock/acquire'
    | 'lock/force'
    | 'lock/release'
    | 'lock/status'

    // Run operations
    | 'run'
    | 'run/build'
    | 'run/dir'
    | 'run/exec'
    | 'run/file'
    | 'run/inspect'
    | 'run/list'

    // Secret management
    | 'secret'
    | 'secret/rm'
    | 'secret/set'

    // Settings
    | 'settings'
    | 'settings/build'
    | 'settings/init'
    | 'settings/logging'
    | 'settings/paths'

    // Settings - Rules
    | 'settings/rules'
    | 'settings/rules/add'
    | 'settings/rules/edit'

    // Settings - Universal secrets
    | 'settings/secrets'
    | 'settings/secrets/add'
    | 'settings/secrets/edit'
    | 'settings/secrets/rm'

    // Settings - Stages
    | 'settings/stages'
    | 'settings/stages/add'
    | 'settings/stages/edit'

    // Settings - Stage secrets
    | 'settings/stages/secrets'
    | 'settings/stages/secrets/add'
    | 'settings/stages/secrets/edit'
    | 'settings/stages/secrets/rm'

    // Settings - Strict mode
    | 'settings/strict'

    // Version info
    | 'version'
/**
 * Route parameters that can be passed during navigation.
 *
 * Different routes use different subsets of these params:
 * - `name`: Config name, change name, secret key
 * - `count`: Numeric parameter (e.g., change/next 5)
 * - `path`: File or directory path
 * - `stage`: Stage name (for stage-specific secrets)
 */
export interface RouteParams {
    /** Named entity (config, change, secret key) */
    name?: string;

    /** Numeric parameter (count for next/rewind) */
    count?: number;

    /** File or directory path */
    path?: string;

    /** Force flag (from --force/-f CLI option) */
    force?: boolean;

    /** Stage name (for stage-specific secret operations) */
    stage?: string;

    /** Schema name (for database exploration) */
    schema?: string;

    /** Operation ID (for history detail view) */
    operationId?: number;

    /** Help topic (multi-part, e.g., "db/explore/tables") */
    topic?: string;

    /** Flag indicating navigation came from init screen */
    fromInit?: boolean;

    /** Debug table name (for debug screen) */
    table?: string;

    /** Row ID (for debug detail view) */
    rowId?: number;
}

/**
 * Navigation history entry.
 *
 * Stores both the route and its params to enable back navigation
 * with full state restoration.
 */
export interface HistoryEntry {
    route: Route;
    params: RouteParams;
}

/**
 * Router state managed by RouterProvider.
 */
export interface RouterState {
    /** Current active route */
    route: Route;

    /** Parameters for current route */
    params: RouteParams;

    /** Navigation history stack */
    history: HistoryEntry[];
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
    navigate: (route: Route, params?: RouteParams) => void;

    /**
     * Go back to previous route in history.
     * Does nothing if at root (no history).
     */
    back: () => void;

    /**
     * Replace current route without adding to history.
     * Useful for redirects.
     */
    replace: (route: Route, params?: RouteParams) => void;

    /**
     * Clear history and return to home.
     */
    reset: () => void;

    /**
     * Whether back navigation is possible.
     */
    canGoBack: boolean;

    /**
     * Get the section from current route (e.g., 'config' from 'config/add').
     */
    section: string;
}

/**
 * Focus stack entry for keyboard input management.
 *
 * Components push onto the focus stack when they need exclusive
 * keyboard input (e.g., modals, text inputs).
 */
export interface FocusEntry {
    /** Unique identifier for this focus claim */
    id: string;

    /** Optional debug label */
    label?: string;
}

/**
 * Focus context value for keyboard input management.
 */
export interface FocusContextValue {
    /**
     * Claim focus for this component.
     * Only the top of the stack receives keyboard input.
     */
    push: (id: string, label?: string) => void;

    /**
     * Release focus for this component.
     * Must match the ID that was pushed.
     */
    pop: (id: string) => void;

    /**
     * Check if this component currently has focus.
     */
    isActive: (id: string) => boolean;

    /**
     * Get the ID of the currently focused component.
     */
    activeId: string | null;

    /**
     * Debug: get the full focus stack.
     */
    stack: FocusEntry[];
}

/**
 * Key event from Ink's useInput hook.
 */
export interface KeyEvent {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
    pageUp: boolean;
    pageDown: boolean;
}

/**
 * Keyboard handler function signature.
 */
export type KeyHandler = (input: string, key: KeyEvent) => void | boolean;

/**
 * CLI execution mode.
 */
export type CliMode = 'tui' | 'headless';

/**
 * CLI flags parsed from command line.
 */
export interface CliFlags {
    /** Force headless mode */
    headless: boolean;

    /** Force TUI mode (overrides headless detection) */
    tui: boolean;

    /** Output JSON in headless mode */
    json: boolean;

    /** Skip confirmations */
    yes: boolean;

    /** Use specific config */
    config?: string;

    /** Force operation */
    force: boolean;

    /** Preview without executing */
    dryRun: boolean;
}

/**
 * Parsed CLI input ready for routing.
 */
export interface ParsedCli {
    /** Determined execution mode */
    mode: CliMode;

    /** Initial route to navigate to */
    route: Route;

    /** Route parameters from CLI args */
    params: RouteParams;

    /** Parsed flags */
    flags: CliFlags;
}

/**
 * Screen component props.
 *
 * All screen components receive route params and can use
 * hooks to access router, focus, etc.
 */
export interface ScreenProps {
    params: RouteParams;
}

/**
 * Screen registry entry.
 */
export interface ScreenEntry {
    /** React component to render */
    component: React.ComponentType<ScreenProps>;

    /** Optional label for breadcrumb */
    label?: string;
}

/**
 * Help entry for keyboard shortcuts overlay.
 */
export interface HelpEntry {
    /** Key or key combination (e.g., 'Esc', 'Ctrl+C') */
    key: string;

    /** Description of action */
    description: string;
}

/**
 * Screen sections for navigation grouping.
 */
export type Section =
    | 'home'
    | 'config'
    | 'debug'
    | 'secret'
    | 'settings'
    | 'change'
    | 'run'
    | 'db'
    | 'lock'
    | 'identity'
    | 'init';

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

    const parts = route.split('/');

    return parts[0] as Section;

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

        return null;

    }

    const parts = route.split('/');

    if (parts.length === 1) {

        return 'home';

    }

    return parts.slice(0, -1).join('/') as Route;

}
