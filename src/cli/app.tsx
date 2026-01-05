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
 * Shows global keyboard shortcuts in a compact horizontal layout.
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

    // Shortcut item component
    const Item = ({ k, desc }: { k: string; desc: string }) => (
        <Text>
            <Text color="yellow">{k.padEnd(12)}</Text>
            <Text dimColor>{desc}</Text>
        </Text>
    );

    return (
        <Box flexDirection="column">
            {/* Divider line */}
            <Box
                borderStyle="single"
                borderTop
                borderBottom={false}
                borderLeft={false}
                borderRight={false}
                borderColor="gray"
            />

            {/* Content - 3 columns */}
            <Box paddingX={1} paddingTop={1}>
                {/* Column 1 - Navigation */}
                <Box flexDirection="column" width={30}>
                    <Item k="esc" desc="go back / cancel" />
                    <Item k="enter" desc="confirm / select" />
                    <Item k="tab" desc="next field" />
                    <Item k="↑ / ↓" desc="navigate items" />
                </Box>

                {/* Column 2 - Modes & Actions */}
                <Box flexDirection="column" width={34}>
                    <Item k="D" desc={`toggle dry-run${globalModes.dryRun ? ' (active)' : ''}`} />
                    <Item k="F" desc={`toggle force${globalModes.force ? ' (active)' : ''}`} />
                    <Item k="shift + L" desc="toggle log viewer" />
                    <Item k="shift + Q" desc="open SQL terminal" />
                </Box>

                {/* Column 3 - Global */}
                <Box flexDirection="column" width={28}>
                    <Item k="?" desc="show this help" />
                    <Item k="ctrl + c" desc="quit application" />
                </Box>
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

    const handleDebugMode = useCallback(() => {

        navigate('debug');

    }, [navigate]);

    return (
        <GlobalKeyboard
            onHelp={handleHelp}
            onToggleDryRun={toggleDryRun}
            onToggleForce={toggleForce}
            onToggleLogViewer={handleToggleLogViewer}
            onOpenSqlTerminal={handleOpenSqlTerminal}
            onDebugMode={handleDebugMode}
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
