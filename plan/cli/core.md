# CLI Core


## Overview

The CLI core provides the foundation for noorm's terminal interface:

- **Router** - Screen navigation with history
- **App Shell** - Root component wrapping all screens
- **Global Keyboard** - Consistent hotkeys across all screens
- **Headless Mode** - Non-interactive CI/CD support
- **Entry Point** - CLI argument parsing and mode detection


## Dependencies

```json
{
    "ink": "^4.4.0",
    "react": "^18.2.0",
    "pastel": "^2.0.0",
    "commander": "^11.1.0",
    "@logosdx/observer": "^x.x.x"
}
```


## File Structure

```
src/cli/
├── index.tsx              # Entry point
├── app.tsx                # Root App component
├── router.tsx             # Router context and provider
├── keyboard.tsx           # Global keyboard handler
├── headless.ts            # Headless mode setup
├── screens.tsx            # Screen registry and renderer
└── types.ts               # CLI types
```


## Types

```typescript
// src/cli/types.ts

export type Route =
    | 'home'
    | 'config' | 'config/add' | 'config/edit' | 'config/rm' | 'config/cp' | 'config/use'
    | 'change' | 'change/add' | 'change/edit' | 'change/rm' | 'change/run' | 'change/revert' | 'change/next' | 'change/ff'
    | 'run' | 'run/build' | 'run/file' | 'run/dir'
    | 'db' | 'db/create' | 'db/destroy'
    | 'lock' | 'lock/status' | 'lock/release';

export type Section = 'config' | 'change' | 'run' | 'db' | 'lock';

export interface RouteParams {
    /** Named parameter (e.g., config name) */
    name?: string;

    /** Count parameter (e.g., for change/next) */
    count?: number;

    /** File path parameter */
    path?: string;
}

export interface RouterState {
    route: Route;
    params: RouteParams;
    history: Array<{ route: Route; params: RouteParams }>;
}

export interface RouterActions {
    navigate: (route: Route, params?: RouteParams) => void;
    back: () => void;
    replace: (route: Route, params?: RouteParams) => void;
    reset: () => void;
}

export type RouterContext = RouterState & RouterActions;

export interface AppOptions {
    /** Initial route to navigate to */
    initialRoute?: Route;

    /** Initial route params */
    initialParams?: RouteParams;

    /** Headless mode (no TUI) */
    headless?: boolean;

    /** JSON output in headless mode */
    json?: boolean;

    /** Skip confirmations */
    yes?: boolean;
}

export interface CliFlags {
    config?: string;
    headless?: boolean;
    json?: boolean;
    yes?: boolean;
    force?: boolean;
    dryRun?: boolean;
}
```


## Router

React context for screen navigation.

```typescript
// src/cli/router.tsx

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Route, RouteParams, RouterContext, RouterState, RouterActions } from './types';

const RouterCtx = createContext<RouterContext | null>(null);

export interface RouterProviderProps {
    initialRoute?: Route;
    initialParams?: RouteParams;
    children: React.ReactNode;
}

export function RouterProvider({
    initialRoute = 'home',
    initialParams = {},
    children
}: RouterProviderProps) {

    const [state, setState] = useState<RouterState>({
        route: initialRoute,
        params: initialParams,
        history: [],
    });

    const navigate = useCallback((route: Route, params: RouteParams = {}) => {

        setState(prev => ({
            route,
            params,
            history: [...prev.history, { route: prev.route, params: prev.params }],
        }));
    }, []);

    const back = useCallback(() => {

        setState(prev => {

            if (prev.history.length === 0) {

                return prev;
            }

            const newHistory = [...prev.history];
            const previous = newHistory.pop()!;

            return {
                route: previous.route,
                params: previous.params,
                history: newHistory,
            };
        });
    }, []);

    const replace = useCallback((route: Route, params: RouteParams = {}) => {

        setState(prev => ({
            ...prev,
            route,
            params,
        }));
    }, []);

    const reset = useCallback(() => {

        setState({
            route: 'home',
            params: {},
            history: [],
        });
    }, []);

    const actions: RouterActions = useMemo(() => ({
        navigate,
        back,
        replace,
        reset,
    }), [navigate, back, replace, reset]);

    const value: RouterContext = useMemo(() => ({
        ...state,
        ...actions,
    }), [state, actions]);

    return (
        <RouterCtx.Provider value={value}>
            {children}
        </RouterCtx.Provider>
    );
}

/**
 * Hook to access router context.
 */
export function useRouter(): RouterContext {

    const ctx = useContext(RouterCtx);

    if (!ctx) {

        throw new Error('useRouter must be used within RouterProvider');
    }

    return ctx;
}

/**
 * Hook to get current route info.
 */
export function useRoute(): { route: Route; params: RouteParams } {

    const { route, params } = useRouter();
    return { route, params };
}

/**
 * Hook to check if we can go back.
 */
export function useCanGoBack(): boolean {

    const { history } = useRouter();
    return history.length > 0;
}

/**
 * Get the section from a route.
 */
export function getSection(route: Route): Section | null {

    if (route === 'home') return null;

    const parts = route.split('/');
    return parts[0] as Section;
}

/**
 * Get parent route for a given route.
 */
export function getParentRoute(route: Route): Route {

    if (route === 'home') return 'home';

    const parts = route.split('/');

    if (parts.length === 1) return 'home';

    return parts[0] as Route;
}
```


## Global Keyboard

Handles keyboard input across all screens.

```typescript
// src/cli/keyboard.tsx

import React, { useEffect, useCallback } from 'react';
import { useInput, useApp } from 'ink';
import { useRouter, useCanGoBack, getSection } from './router';
import { Route, Section } from './types';

const SECTIONS: Section[] = ['config', 'change', 'run', 'db', 'lock'];

export interface GlobalKeyboardProps {
    children: React.ReactNode;
    onHelp?: () => void;
}

export function GlobalKeyboard({ children, onHelp }: GlobalKeyboardProps) {

    const { exit } = useApp();
    const { route, navigate, back } = useRouter();
    const canGoBack = useCanGoBack();

    useInput((input, key) => {

        // Quit
        if (input === 'q' && !key.ctrl) {

            exit();
            return;
        }

        // Help
        if (input === '?') {

            onHelp?.();
            return;
        }

        // Back navigation
        if (key.escape || (key.backspace && canGoBack)) {

            if (canGoBack) {

                back();
            }
            return;
        }

        // Tab navigation between sections (only on home or section root)
        if (key.tab && (route === 'home' || !route.includes('/'))) {

            const currentSection = getSection(route);
            const currentIndex = currentSection ? SECTIONS.indexOf(currentSection) : -1;

            let nextIndex: number;

            if (key.shift) {

                // Shift+Tab: go to previous section
                nextIndex = currentIndex <= 0 ? SECTIONS.length - 1 : currentIndex - 1;
            }
            else {

                // Tab: go to next section
                nextIndex = currentIndex >= SECTIONS.length - 1 ? 0 : currentIndex + 1;
            }

            navigate(SECTIONS[nextIndex] as Route);
            return;
        }
    });

    return <>{children}</>;
}

/**
 * Hook for screen-specific keyboard handling.
 */
export function useScreenInput(
    handlers: Record<string, () => void>,
    deps: React.DependencyList = []
) {

    useInput(useCallback((input, key) => {

        // Check for single key handlers
        if (handlers[input]) {

            handlers[input]();
            return;
        }

        // Check for special keys
        if (key.return && handlers['enter']) {

            handlers['enter']();
            return;
        }

        if (key.upArrow && handlers['up']) {

            handlers['up']();
            return;
        }

        if (key.downArrow && handlers['down']) {

            handlers['down']();
            return;
        }

        if (key.leftArrow && handlers['left']) {

            handlers['left']();
            return;
        }

        if (key.rightArrow && handlers['right']) {

            handlers['right']();
            return;
        }
    }, deps));
}
```


## Screen Registry

Maps routes to screen components.

```typescript
// src/cli/screens.tsx

import React from 'react';
import { Route } from './types';
import { useRoute } from './router';

// Screen imports (lazy loaded)
const screens: Record<Route, React.LazyExoticComponent<React.FC<any>>> = {
    // Home
    'home': React.lazy(() => import('./screens/home')),

    // Config
    'config': React.lazy(() => import('./screens/config/list')),
    'config/add': React.lazy(() => import('./screens/config/add')),
    'config/edit': React.lazy(() => import('./screens/config/edit')),
    'config/rm': React.lazy(() => import('./screens/config/rm')),
    'config/cp': React.lazy(() => import('./screens/config/cp')),
    'config/use': React.lazy(() => import('./screens/config/use')),

    // Change
    'change': React.lazy(() => import('./screens/change/list')),
    'change/add': React.lazy(() => import('./screens/change/add')),
    'change/edit': React.lazy(() => import('./screens/change/edit')),
    'change/rm': React.lazy(() => import('./screens/change/rm')),
    'change/run': React.lazy(() => import('./screens/change/run')),
    'change/revert': React.lazy(() => import('./screens/change/revert')),
    'change/next': React.lazy(() => import('./screens/change/next')),
    'change/ff': React.lazy(() => import('./screens/change/ff')),

    // Run
    'run': React.lazy(() => import('./screens/run/list')),
    'run/build': React.lazy(() => import('./screens/run/build')),
    'run/file': React.lazy(() => import('./screens/run/file')),
    'run/dir': React.lazy(() => import('./screens/run/dir')),

    // DB
    'db': React.lazy(() => import('./screens/db/list')),
    'db/create': React.lazy(() => import('./screens/db/create')),
    'db/destroy': React.lazy(() => import('./screens/db/destroy')),

    // Lock
    'lock': React.lazy(() => import('./screens/lock/list')),
    'lock/status': React.lazy(() => import('./screens/lock/status')),
    'lock/release': React.lazy(() => import('./screens/lock/release')),
};

export function ScreenRenderer() {

    const { route, params } = useRoute();

    const Screen = screens[route];

    if (!Screen) {

        return <FallbackScreen route={route} />;
    }

    return (
        <React.Suspense fallback={<LoadingScreen />}>
            <Screen {...params} />
        </React.Suspense>
    );
}

function LoadingScreen() {

    return <Text>Loading...</Text>;
}

function FallbackScreen({ route }: { route: string }) {

    return <Text color="red">Unknown route: {route}</Text>;
}

// Re-export for convenience
import { Text } from 'ink';
```


## App Shell

Root component that wraps everything.

```typescript
// src/cli/app.tsx

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { RouterProvider } from './router';
import { GlobalKeyboard } from './keyboard';
import { ScreenRenderer } from './screens';
import { AppOptions } from './types';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HelpOverlay } from './components/HelpOverlay';

export interface AppProps extends AppOptions {}

export function App({
    initialRoute = 'home',
    initialParams = {},
}: AppProps) {

    const [showHelp, setShowHelp] = useState(false);

    return (
        <RouterProvider initialRoute={initialRoute} initialParams={initialParams}>
            <GlobalKeyboard onHelp={() => setShowHelp(true)}>
                <Box flexDirection="column" minHeight={20}>

                    <Header />

                    <Box flexGrow={1} flexDirection="column" paddingX={1}>
                        <ScreenRenderer />
                    </Box>

                    <Footer />

                    {showHelp && (
                        <HelpOverlay onClose={() => setShowHelp(false)} />
                    )}

                </Box>
            </GlobalKeyboard>
        </RouterProvider>
    );
}
```


## Headless Mode

Non-interactive output for CI/CD.

```typescript
// src/cli/headless.ts

import { observer } from '../core/observer';

export interface HeadlessOptions {
    json: boolean;
}

/**
 * Setup headless logging - subscribes to observer events and outputs to console.
 */
export function setupHeadlessLogging(options: HeadlessOptions): () => void {

    const cleanups: Array<() => void> = [];

    if (options.json) {

        // JSON lines output for machine parsing
        cleanups.push(
            observer.on(/.*/, ({ event, data }) => {

                console.log(JSON.stringify({
                    event,
                    data,
                    timestamp: Date.now()
                }));
            })
        );

        return () => cleanups.forEach(c => c());
    }

    // Human-readable output

    // Build events
    cleanups.push(
        observer.on('build:start', ({ schemaPath, fileCount }) => {

            console.log(`Building schema from ${schemaPath} (${fileCount} files)...`);
        })
    );

    cleanups.push(
        observer.on('build:complete', ({ status, filesRun, filesSkipped, durationMs }) => {

            const icon = status === 'success' ? '\u2713' : '\u2717';
            console.log(`${icon} Build ${status}: ${filesRun} run, ${filesSkipped} skipped (${Math.round(durationMs)}ms)`);
        })
    );

    // File events
    cleanups.push(
        observer.on('file:before', ({ filepath }) => {

            process.stdout.write(`  Running ${filepath}...`);
        })
    );

    cleanups.push(
        observer.on('file:after', ({ filepath, status, durationMs, error }) => {

            const icon = status === 'success' ? '\u2713' : '\u2717';
            const suffix = error ? ` - ${error}` : '';
            console.log(` ${icon} (${Math.round(durationMs!)}ms)${suffix}`);
        })
    );

    cleanups.push(
        observer.on('file:skip', ({ filepath, reason }) => {

            console.log(`  \u25cb ${filepath} (${reason})`);
        })
    );

    // Changeset events
    cleanups.push(
        observer.on('changeset:start', ({ name, direction, files }) => {

            console.log(`${direction === 'change' ? 'Applying' : 'Reverting'} changeset: ${name} (${files.length} files)`);
        })
    );

    cleanups.push(
        observer.on('changeset:complete', ({ name, status, durationMs }) => {

            const icon = status === 'success' ? '\u2713' : '\u2717';
            console.log(`${icon} Changeset ${name}: ${status} (${Math.round(durationMs)}ms)`);
        })
    );

    // Lock events
    cleanups.push(
        observer.on('lock:blocked', ({ holder, heldSince }) => {

            console.error(`Blocked: database locked by ${holder} since ${heldSince.toISOString()}`);
        })
    );

    cleanups.push(
        observer.on('lock:acquired', ({ identity }) => {

            console.log(`Lock acquired by ${identity}`);
        })
    );

    // DB events
    cleanups.push(
        observer.on('db:creating', ({ database }) => {

            console.log(`Creating database: ${database}...`);
        })
    );

    cleanups.push(
        observer.on('db:created', ({ database, durationMs }) => {

            console.log(`\u2713 Database created: ${database} (${Math.round(durationMs)}ms)`);
        })
    );

    cleanups.push(
        observer.on('db:destroying', ({ database }) => {

            console.log(`Destroying database: ${database}...`);
        })
    );

    cleanups.push(
        observer.on('db:destroyed', ({ database }) => {

            console.log(`\u2713 Database destroyed: ${database}`);
        })
    );

    // Error events
    cleanups.push(
        observer.on('error', ({ source, error }) => {

            console.error(`Error [${source}]: ${error.message}`);
        })
    );

    return () => cleanups.forEach(c => c());
}

/**
 * Check if running in headless mode.
 */
export function isHeadlessMode(): boolean {

    // Explicit flag
    if (process.env.NOORM_HEADLESS === '1') return true;

    // CI environment detection
    if (process.env.CI === '1' || process.env.CI === 'true') return true;

    // Common CI environment variables
    if (process.env.GITHUB_ACTIONS) return true;
    if (process.env.GITLAB_CI) return true;
    if (process.env.CIRCLECI) return true;
    if (process.env.JENKINS_URL) return true;
    if (process.env.TRAVIS) return true;

    // No TTY
    if (!process.stdout.isTTY) return true;

    return false;
}

/**
 * Check if JSON output is requested.
 */
export function isJsonOutput(): boolean {

    return process.env.NOORM_JSON === '1';
}

/**
 * Check if confirmations should be skipped.
 */
export function shouldSkipConfirmations(): boolean {

    return process.env.NOORM_YES === '1';
}
```


## Entry Point

CLI argument parsing and app initialization.

```typescript
// src/cli/index.tsx

import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './app';
import { Route, CliFlags } from './types';
import { setupHeadlessLogging, isHeadlessMode, isJsonOutput, shouldSkipConfirmations } from './headless';
import { runHeadlessCommand } from './headless-commands';

const program = new Command();

program
    .name('noorm')
    .description('Database Schema & Changeset Manager')
    .version('0.1.0')
    .option('-H, --headless', 'Run in headless mode (no TUI)')
    .option('--json', 'Output JSON (headless mode)')
    .option('-y, --yes', 'Skip confirmations')
    .option('-c, --config <name>', 'Use specific config')
    .option('-f, --force', 'Force operation')
    .option('--dry-run', 'Show what would be done without executing');

// No subcommand - open TUI at home
program
    .action((options: CliFlags) => {

        startApp('home', {}, options);
    });

// Config commands
program
    .command('config')
    .description('Manage database configurations')
    .action((options: CliFlags) => startApp('config', {}, options));

program
    .command('config:add')
    .description('Add a new configuration')
    .action((options: CliFlags) => startApp('config/add', {}, options));

program
    .command('config:edit <name>')
    .description('Edit a configuration')
    .action((name: string, options: CliFlags) => startApp('config/edit', { name }, options));

program
    .command('config:rm <name>')
    .description('Remove a configuration')
    .action((name: string, options: CliFlags) => startApp('config/rm', { name }, options));

program
    .command('config:cp <from> <to>')
    .description('Copy a configuration')
    .action((from: string, to: string, options: CliFlags) => startApp('config/cp', { from, to } as any, options));

program
    .command('config:use <name>')
    .description('Set active configuration')
    .action((name: string, options: CliFlags) => startApp('config/use', { name }, options));

// Change commands
program
    .command('change')
    .description('Manage changesets')
    .action((options: CliFlags) => startApp('change', {}, options));

program
    .command('change:add [name]')
    .description('Create a new changeset')
    .action((name: string | undefined, options: CliFlags) => startApp('change/add', { name }, options));

program
    .command('change:run <name>')
    .description('Run a changeset')
    .action((name: string, options: CliFlags) => startApp('change/run', { name }, options));

program
    .command('change:revert <name>')
    .description('Revert a changeset')
    .action((name: string, options: CliFlags) => startApp('change/revert', { name }, options));

program
    .command('change:next [count]')
    .description('Apply next N pending changesets')
    .action((count: string | undefined, options: CliFlags) => {

        startApp('change/next', { count: count ? parseInt(count, 10) : 1 }, options);
    });

program
    .command('change:ff')
    .description('Fast-forward: apply all pending changesets')
    .action((options: CliFlags) => startApp('change/ff', {}, options));

// Run commands
program
    .command('run')
    .description('Execute SQL files')
    .action((options: CliFlags) => startApp('run', {}, options));

program
    .command('run:build')
    .alias('build')
    .description('Build schema from scratch')
    .action((options: CliFlags) => startApp('run/build', {}, options));

program
    .command('run:file <path>')
    .description('Execute a single SQL file')
    .action((path: string, options: CliFlags) => startApp('run/file', { path }, options));

program
    .command('run:dir <path>')
    .description('Execute all SQL files in a directory')
    .action((path: string, options: CliFlags) => startApp('run/dir', { path }, options));

// DB commands
program
    .command('db')
    .description('Database lifecycle management')
    .action((options: CliFlags) => startApp('db', {}, options));

program
    .command('db:create')
    .description('Create the database')
    .action((options: CliFlags) => startApp('db/create', {}, options));

program
    .command('db:destroy')
    .description('Destroy the database')
    .action((options: CliFlags) => startApp('db/destroy', {}, options));

// Lock commands
program
    .command('lock')
    .description('Lock management')
    .action((options: CliFlags) => startApp('lock', {}, options));

program
    .command('lock:status')
    .description('Check lock status')
    .action((options: CliFlags) => startApp('lock/status', {}, options));

program
    .command('lock:release')
    .description('Force release lock')
    .action((options: CliFlags) => startApp('lock/release', {}, options));

/**
 * Start the app in appropriate mode.
 */
async function startApp(route: Route, params: any, flags: CliFlags) {

    const headless = flags.headless || isHeadlessMode();
    const json = flags.json || isJsonOutput();
    const yes = flags.yes || shouldSkipConfirmations();

    // Store flags in process for access by screens
    process.env.NOORM_CONFIG_OVERRIDE = flags.config ?? '';
    process.env.NOORM_FORCE = flags.force ? '1' : '';
    process.env.NOORM_DRY_RUN = flags.dryRun ? '1' : '';
    process.env.NOORM_YES = yes ? '1' : '';

    if (headless) {

        // Headless mode - run command directly
        const cleanup = setupHeadlessLogging({ json });

        try {

            const exitCode = await runHeadlessCommand(route, params, {
                force: flags.force,
                dryRun: flags.dryRun,
                yes,
            });

            cleanup();
            process.exit(exitCode);
        }
        catch (error) {

            cleanup();
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    }
    else {

        // TUI mode
        const { waitUntilExit } = render(
            <App
                initialRoute={route}
                initialParams={params}
            />
        );

        await waitUntilExit();
    }
}

// Parse and run
program.parse();
```


## Headless Commands

Execute commands without TUI.

```typescript
// src/cli/headless-commands.ts

import { Route, RouteParams } from './types';
import { getStateManager } from '../core/state';
import { createConnection, getConnectionManager } from '../core/connection';
import { Runner } from '../core/runner';
import { ChangesetManager } from '../core/changeset';
import { LockManager } from '../core/lock';
import { attempt } from '@logosdx/utils';

export interface HeadlessCommandOptions {
    force?: boolean;
    dryRun?: boolean;
    yes?: boolean;
}

/**
 * Execute a command in headless mode.
 * Returns exit code (0 for success, 1 for failure).
 */
export async function runHeadlessCommand(
    route: Route,
    params: RouteParams,
    options: HeadlessCommandOptions
): Promise<number> {

    const state = await getStateManager();
    await state.load();

    const config = state.getActiveConfig();

    if (!config && route !== 'config' && route !== 'config/add') {

        console.error('No active config. Run `noorm config:add` or `noorm config:use <name>` first.');
        return 1;
    }

    try {

        switch (route) {

            // Build
            case 'run/build': {

                const conn = await createConnection(config!.connection, config!.name);
                const runner = new Runner(conn.db, config!);

                await runner.getTracker().ensureTable();

                const result = await runner.build({
                    force: options.force,
                    dryRun: options.dryRun,
                });

                await conn.destroy();

                return result.status === 'success' ? 0 : 1;
            }

            // Run file
            case 'run/file': {

                if (!params.path) {

                    console.error('File path required');
                    return 1;
                }

                const conn = await createConnection(config!.connection, config!.name);
                const runner = new Runner(conn.db, config!);

                await runner.getTracker().ensureTable();

                const result = await runner.runFile(params.path, {
                    force: options.force,
                    dryRun: options.dryRun,
                });

                await conn.destroy();

                return result.status === 'success' || result.status === 'skipped' ? 0 : 1;
            }

            // Run dir
            case 'run/dir': {

                if (!params.path) {

                    console.error('Directory path required');
                    return 1;
                }

                const conn = await createConnection(config!.connection, config!.name);
                const runner = new Runner(conn.db, config!);

                await runner.getTracker().ensureTable();

                const result = await runner.runDir(params.path, {
                    force: options.force,
                    dryRun: options.dryRun,
                });

                await conn.destroy();

                return result.status === 'success' ? 0 : 1;
            }

            // Changeset run
            case 'change/run': {

                if (!params.name) {

                    console.error('Changeset name required');
                    return 1;
                }

                // Check protected config
                if (config!.protected && !options.yes) {

                    console.error(`Config "${config!.name}" is protected. Use --yes to confirm.`);
                    return 1;
                }

                const conn = await createConnection(config!.connection, config!.name);
                const manager = new ChangesetManager(conn.db, config!);

                await manager.ensureTables();

                const result = await manager.run(params.name, {
                    dryRun: options.dryRun,
                });

                await conn.destroy();

                return result.status === 'success' ? 0 : 1;
            }

            // Changeset revert
            case 'change/revert': {

                if (!params.name) {

                    console.error('Changeset name required');
                    return 1;
                }

                if (config!.protected && !options.yes) {

                    console.error(`Config "${config!.name}" is protected. Use --yes to confirm.`);
                    return 1;
                }

                const conn = await createConnection(config!.connection, config!.name);
                const manager = new ChangesetManager(conn.db, config!);

                await manager.ensureTables();

                const result = await manager.revert(params.name, {
                    dryRun: options.dryRun,
                });

                await conn.destroy();

                return result.status === 'success' ? 0 : 1;
            }

            // Changeset next
            case 'change/next': {

                if (config!.protected && !options.yes) {

                    console.error(`Config "${config!.name}" is protected. Use --yes to confirm.`);
                    return 1;
                }

                const conn = await createConnection(config!.connection, config!.name);
                const manager = new ChangesetManager(conn.db, config!);

                await manager.ensureTables();

                const results = await manager.next(params.count ?? 1, {
                    dryRun: options.dryRun,
                });

                await conn.destroy();

                const failed = results.some(r => r.status === 'failed');
                return failed ? 1 : 0;
            }

            // Changeset ff
            case 'change/ff': {

                if (config!.protected && !options.yes) {

                    console.error(`Config "${config!.name}" is protected. Use --yes to confirm.`);
                    return 1;
                }

                const conn = await createConnection(config!.connection, config!.name);
                const manager = new ChangesetManager(conn.db, config!);

                await manager.ensureTables();

                const results = await manager.fastForward({
                    dryRun: options.dryRun,
                });

                await conn.destroy();

                if (results.length === 0) {

                    console.log('No pending changesets');
                }

                const failed = results.some(r => r.status === 'failed');
                return failed ? 1 : 0;
            }

            // Lock status
            case 'lock/status': {

                const conn = await createConnection(config!.connection, config!.name);
                const lockManager = new LockManager(conn.db, config!.connection.dialect, config!.name);

                const status = await lockManager.getStatus();

                if (status) {

                    console.log(`Lock status: LOCKED`);
                    console.log(`  Holder: ${status.lockedBy}`);
                    console.log(`  Since: ${status.lockedAt.toISOString()}`);
                    console.log(`  Expires: ${status.expiresAt.toISOString()}`);

                    const expired = new Date() > status.expiresAt;
                    if (expired) {

                        console.log(`  Status: EXPIRED`);
                    }
                }
                else {

                    console.log('Lock status: UNLOCKED');
                }

                await conn.destroy();
                return 0;
            }

            // Lock release
            case 'lock/release': {

                if (config!.protected && !options.yes) {

                    console.error(`Config "${config!.name}" is protected. Use --yes to confirm.`);
                    return 1;
                }

                const conn = await createConnection(config!.connection, config!.name);
                const lockManager = new LockManager(conn.db, config!.connection.dialect, config!.name);

                await lockManager.forceRelease();
                console.log('Lock released');

                await conn.destroy();
                return 0;
            }

            // Config use
            case 'config/use': {

                if (!params.name) {

                    console.error('Config name required');
                    return 1;
                }

                const existing = state.getConfig(params.name);

                if (!existing) {

                    console.error(`Config "${params.name}" not found`);
                    return 1;
                }

                await state.setActiveConfig(params.name);
                console.log(`Active config set to: ${params.name}`);
                return 0;
            }

            // Config list
            case 'config': {

                const configs = state.listConfigs();

                if (configs.length === 0) {

                    console.log('No configurations found');
                    return 0;
                }

                console.log('Configurations:');

                for (const cfg of configs) {

                    const active = cfg.isActive ? ' (active)' : '';
                    const protected_ = cfg.protected ? ' [protected]' : '';
                    console.log(`  ${cfg.name}${active}${protected_}`);
                }

                return 0;
            }

            // Change list
            case 'change': {

                const conn = await createConnection(config!.connection, config!.name);
                const manager = new ChangesetManager(conn.db, config!);

                const changesets = await manager.list();

                if (changesets.length === 0) {

                    console.log('No changesets found');
                }
                else {

                    console.log('Changesets:');

                    for (const cs of changesets) {

                        const icon = cs.status.applied ? '\u2713' : '\u25cb';
                        console.log(`  ${icon} ${cs.name}`);

                        if (cs.status.applied) {

                            console.log(`      Applied: ${cs.status.appliedAt?.toISOString()}`);
                        }
                    }
                }

                await conn.destroy();
                return 0;
            }

            default: {

                console.error(`Command not supported in headless mode: ${route}`);
                console.error('Use the TUI for interactive operations.');
                return 1;
            }
        }
    }
    finally {

        await getConnectionManager().closeAll();
    }
}
```


## Context Provider

Combines all providers for the app.

```typescript
// src/cli/providers.tsx

import React from 'react';
import { StateProvider } from './state-context';
import { ConfigProvider } from './config-context';

export interface ProvidersProps {
    children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {

    return (
        <StateProvider>
            <ConfigProvider>
                {children}
            </ConfigProvider>
        </StateProvider>
    );
}
```


## Usage Examples


### Running TUI

```bash
# Open home screen
noorm

# Jump to specific screen
noorm config
noorm change
noorm run:build

# With parameters
noorm config:edit production
noorm change:run 2024-01-15_add-users
```


### Running Headless

```bash
# Explicit headless
noorm -H run:build

# Auto-detected in CI
CI=1 noorm change:ff

# With JSON output
noorm -H --json run:build

# Skip confirmations on protected config
noorm -H -y change:run 2024-01-15_migration

# Dry run
noorm -H --dry-run change:ff
```


### Environment Variables

```bash
# Config override
NOORM_CONFIG=production noorm run:build

# Force headless
NOORM_HEADLESS=1 noorm run:build

# JSON output
NOORM_JSON=1 noorm change:ff

# Skip confirmations
NOORM_YES=1 noorm db:destroy
```


## Keyboard Reference

| Key | Scope | Action |
|-----|-------|--------|
| `q` | Global | Quit application |
| `?` | Global | Show help overlay |
| `Esc` | Global | Go back / Cancel |
| `Backspace` | Global | Go back |
| `Tab` | Home/Section | Next section |
| `Shift+Tab` | Home/Section | Previous section |
| `Enter` | Lists | Select item |
| `↑` / `↓` | Lists | Navigate items |
| `a` | Lists | Add new item |
| `e` | Lists | Edit selected |
| `d` | Lists | Delete selected |


## Testing

```typescript
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app';
import { RouterProvider, useRouter } from './router';

describe('Router', () => {

    it('should start at initial route', () => {

        const { lastFrame } = render(
            <RouterProvider initialRoute="config">
                <TestComponent />
            </RouterProvider>
        );

        expect(lastFrame()).toContain('config');
    });

    it('should navigate to new route', () => {

        const { lastFrame, stdin } = render(
            <RouterProvider initialRoute="home">
                <NavigationTest />
            </RouterProvider>
        );

        // Trigger navigation
        stdin.write('n'); // Custom handler to navigate

        expect(lastFrame()).toContain('config');
    });

    it('should go back', () => {

        const { lastFrame, stdin } = render(
            <RouterProvider initialRoute="home">
                <BackTest />
            </RouterProvider>
        );

        stdin.write('n'); // Navigate to config
        stdin.write('b'); // Go back

        expect(lastFrame()).toContain('home');
    });
});

function TestComponent() {

    const { route } = useRouter();
    return <Text>{route}</Text>;
}

import { Text } from 'ink';
```
