/**
 * Root App component for noorm CLI.
 *
 * Sets up the provider hierarchy and renders the current screen.
 * This is the main entry point for the TUI.
 *
 * Provider hierarchy:
 * ```
 * AppContextProvider
 *   └── FocusProvider
 *         └── RouterProvider
 *               └── GlobalKeyboard
 *                     └── AppShell
 *                           └── ScreenRenderer
 * ```
 */
import { useState, useCallback } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, Spacer } from 'ink';

import type { Route, RouteParams } from './types.js';
import { RouterProvider, useRouter } from './router.js';
import { FocusProvider } from './focus.js';
import { GlobalKeyboard } from './keyboard.js';
import { ScreenRenderer, getRouteLabel } from './screens.js';
import {
    AppContextProvider,
    useActiveConfig,
    useConnectionStatus,
    useLockStatus,
    useProjectName,
} from './app-context.js';
import { ToastProvider, ToastRenderer } from './components/index.js';
import { ShutdownProvider } from './shutdown.js';

/**
 * Help overlay content.
 *
 * Shows global keyboard shortcuts.
 */
function HelpOverlay({ onClose: _onClose }: { onClose: () => void }): ReactElement {

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={2}
            paddingY={1}
            position="absolute"
            marginLeft={4}
            marginTop={2}
        >
            <Text bold color="cyan">
                Keyboard Shortcuts
            </Text>

            <Box marginTop={1} flexDirection="column">
                <Text bold>Navigation</Text>
                <Text>
                    <Text color="cyan">Esc </Text> Go back / Cancel
                </Text>
                <Text>
                    <Text color="cyan">Enter </Text> Confirm / Select
                </Text>
                <Text>
                    <Text color="cyan">Tab </Text> Next field / Switch mode
                </Text>
                <Text>
                    <Text color="cyan">↑/↓ </Text> Navigate items
                </Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold>Global</Text>
                <Text>
                    <Text color="cyan">? </Text> Show this help
                </Text>
                <Text>
                    <Text color="cyan">Ctrl+C </Text> Quit application
                </Text>
            </Box>

            <Box marginTop={1}>
                <Text dimColor>Press any key to close</Text>
            </Box>
        </Box>
    );

}

/**
 * Breadcrumb component showing navigation path.
 */
function Breadcrumb(): ReactElement {

    const { route, history } = useRouter();

    // Build breadcrumb trail
    const trail: string[] = history
        .slice(-2) // Show last 2 history entries
        .map((entry) => getRouteLabel(entry.route));

    trail.push(getRouteLabel(route));

    return (
        <Box>
            {trail.map((label, index) => (
                <Text key={index}>
                    {index > 0 && <Text dimColor> › </Text>}
                    <Text color={index === trail.length - 1 ? 'white' : 'gray'}>{label}</Text>
                </Text>
            ))}
        </Box>
    );

}

/**
 * Status bar showing project, config, connection, and lock status.
 *
 * Reads state from AppContext and displays current status.
 */
function StatusBar(): ReactElement {

    const { projectName } = useProjectName();
    const { activeConfigName } = useActiveConfig();
    const { connectionStatus } = useConnectionStatus();
    const { lockStatus } = useLockStatus();

    const configName = activeConfigName ?? 'none';
    const isConnected = connectionStatus === 'connected';
    const isLockFree = lockStatus.status === 'free';

    return (
        <Box paddingX={1} width="100%">
            <Box marginRight={1}>
                <Text bold color="cyan">
                    {projectName}
                </Text>
            </Box>
            <Box>
                <Text dimColor> │ </Text>
                <Text dimColor>{configName}</Text>
                <Text dimColor> │ </Text>
                <Text color={isConnected ? 'green' : 'gray'}>{isConnected ? '●' : '○'}</Text>
                <Text dimColor> │ </Text>
                <Text color={isLockFree ? 'green' : 'yellow'}>{isLockFree ? '🔓' : '🔒'}</Text>
            </Box>
            <Spacer />

            <Box justifyContent="flex-end">
                <ToastRenderer />
            </Box>
        </Box>
    );

}

/**
 * App shell component.
 *
 * Provides the layout structure:
 * - Header with breadcrumb
 * - Main content area (screen)
 * - Status bar
 */
function AppShell(): ReactElement {

    const [showHelp, setShowHelp] = useState(false);

    const handleHelp = useCallback(() => {

        setShowHelp(true);

    }, []);

    const handleCloseHelp = useCallback(() => {

        setShowHelp(false);

    }, []);

    return (
        <GlobalKeyboard onHelp={handleHelp}>
            <Box flexDirection="column" minHeight={20}>
                {/* Header */}
                <Box
                    borderStyle="single"
                    borderBottom
                    borderTop={false}
                    borderLeft={false}
                    borderRight={false}
                    borderColor="gray"
                    paddingX={1}
                >
                    <Breadcrumb />
                </Box>

                {/* Main Content */}
                <Box flexDirection="column" flexGrow={1}>
                    <ScreenRenderer />
                </Box>

                {/* Status Bar */}
                <Box
                    borderStyle="single"
                    borderTop
                    borderBottom={false}
                    borderLeft={false}
                    borderRight={false}
                    borderColor="gray"
                >
                    <StatusBar />
                </Box>

                {/* Help Overlay */}
                {showHelp && <HelpOverlay onClose={handleCloseHelp} />}
            </Box>
        </GlobalKeyboard>
    );

}

/**
 * Props for the App component.
 */
export interface AppProps {
    /** Initial route to display */
    initialRoute?: Route;

    /** Initial route parameters */
    initialParams?: RouteParams;

    /** Project root directory (defaults to process.cwd()) */
    projectRoot?: string;

    /** Whether to auto-load state/settings on mount (defaults to true) */
    autoLoad?: boolean;
}

/**
 * Root App component.
 *
 * Sets up all providers and renders the app shell.
 *
 * @example
 * ```tsx
 * render(<App initialRoute="home" />)
 * ```
 */
export function App({
    initialRoute = 'home',
    initialParams = {},
    projectRoot,
    autoLoad = true,
}: AppProps): ReactElement {

    const root = projectRoot ?? process.cwd();

    return (
        <ShutdownProvider projectRoot={root}>
            <AppContextProvider projectRoot={projectRoot} autoLoad={autoLoad}>
                <ToastProvider>
                    <FocusProvider>
                        <RouterProvider initialRoute={initialRoute} initialParams={initialParams}>
                            <AppShell />
                        </RouterProvider>
                    </FocusProvider>
                </ToastProvider>
            </AppContextProvider>
        </ShutdownProvider>
    );

}
