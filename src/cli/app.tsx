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
import { Box, Text, Spacer, useInput } from 'ink';

import { useFocusScope } from './focus.js';

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
    useGlobalModes,
    useDryRunMode,
    useForceMode,
} from './app-context.js';
import { ToastProvider, ToastRenderer, LogViewerOverlay } from './components/index.js';
import { ShutdownProvider } from './shutdown.js';

/**
 * Help screen content.
 *
 * Shows global keyboard shortcuts.
 */
function HelpScreen({ onClose }: { onClose: () => void }): ReactElement {

    const globalModes = useGlobalModes();
    const { isFocused } = useFocusScope('HelpScreen');

    // Any key closes help
    useInput(() => {

        if (isFocused) {

            onClose();

        }

    });

    return (
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
                <Text dimColor bold>Keyboard Shortcuts</Text>
            </Box>

            {/* Content */}
            <Box flexDirection="column" paddingX={1} paddingY={1} gap={1} flexGrow={1}>
                <Box flexDirection="column">
                    <Text dimColor bold>Navigation</Text>
                    <Text dimColor>Esc       Go back / Cancel</Text>
                    <Text dimColor>Enter     Confirm / Select</Text>
                    <Text dimColor>Tab       Next field / Switch mode</Text>
                    <Text dimColor>↑/↓       Navigate items</Text>
                </Box>

                <Box flexDirection="column">
                    <Text dimColor bold>Global Modes</Text>
                    <Text dimColor>
                        D         Toggle dry-run mode{' '}
                        {globalModes.dryRun && <Text color="yellow">(active)</Text>}
                    </Text>
                    <Text dimColor>
                        F         Toggle force mode{' '}
                        {globalModes.force && <Text color="red">(active)</Text>}
                    </Text>
                </Box>

                <Box flexDirection="column">
                    <Text dimColor bold>Global</Text>
                    <Text dimColor>?         Show this help</Text>
                    <Text dimColor>Shift+L   Toggle log viewer</Text>
                    <Text dimColor>Shift+Q   Open SQL terminal</Text>
                    <Text dimColor>Ctrl+C    Quit application</Text>
                </Box>
            </Box>

            {/* Footer */}
            <Box
                borderStyle="single"
                borderTop
                borderBottom={false}
                borderLeft={false}
                borderRight={false}
                borderColor="gray"
                paddingX={1}
            >
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
 * Status bar showing project, config, connection, lock status, and global modes.
 *
 * Reads state from AppContext and displays current status.
 */
function StatusBar(): ReactElement {

    const { projectName } = useProjectName();
    const { activeConfigName } = useActiveConfig();
    const { connectionStatus } = useConnectionStatus();
    const { lockStatus } = useLockStatus();
    const globalModes = useGlobalModes();

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
                {/* Global mode indicators */}
                {globalModes.dryRun && (
                    <>
                        <Text dimColor> │ </Text>
                        <Text color="yellow" bold>DRY</Text>
                    </>
                )}
                {globalModes.force && (
                    <>
                        <Text dimColor> │ </Text>
                        <Text color="red" bold>FORCE</Text>
                    </>
                )}
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
    const [showLogViewer, setShowLogViewer] = useState(false);
    const { toggleDryRun } = useDryRunMode();
    const { toggleForce } = useForceMode();
    const { navigate } = useRouter();

    const handleHelp = useCallback(() => {

        setShowHelp(true);

    }, []);

    const handleCloseHelp = useCallback(() => {

        setShowHelp(false);

    }, []);

    const handleToggleLogViewer = useCallback(() => {

        setShowLogViewer((prev) => !prev);

    }, []);

    const handleOpenSqlTerminal = useCallback(() => {

        navigate('db/sql');

    }, [navigate]);

    return (
        <GlobalKeyboard
            onHelp={handleHelp}
            onToggleDryRun={toggleDryRun}
            onToggleForce={toggleForce}
            onToggleLogViewer={handleToggleLogViewer}
            onOpenSqlTerminal={handleOpenSqlTerminal}
        >
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

            </Box>

            {/* Help Screen - Full screen takeover */}
            {showHelp && <HelpScreen onClose={handleCloseHelp} />}

            {/* Log Viewer - Full screen takeover */}
            {showLogViewer && <LogViewerOverlay onClose={handleToggleLogViewer} />}
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
