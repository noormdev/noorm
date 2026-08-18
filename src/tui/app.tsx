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
import { useState, useCallback, useEffect } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, Spacer, useInput, useWindowSize } from 'ink';

import { useFocusScope } from './focus.js';

import type { Route, RouteParams } from './types.js';
import { RouterProvider, useRouter } from './router.js';
import { FocusProvider } from './focus.js';
import { GlobalKeyboard } from './keyboard.js';
import { ScreenRenderer, getRouteLabel } from './screens.js';
import {
    AppContextProvider,
    useActiveConfig,
    useLockStatus,
    useProjectName,
    useGlobalModes,
    useDryRunMode,
    useForceMode,
    useSettings,
} from './app-context.js';
import { MouseProvider, useMouseTransport } from './mouse.js';
import { isMouseEnabled } from '../core/settings/defaults.js';
import { ToastProvider, ToastRenderer, LogViewerOverlay, useToast } from './components/index.js';
import { ShutdownProvider } from './shutdown.js';
import { ConnectionProvider, useConnectionContext } from './providers/ConnectionProvider.js';
import { NoormObserver } from './observer-context.js';
import { useUpdateChecker, useOnEvent } from './hooks/index.js';

/**
 * Help screen content.
 *
 * Shows global keyboard shortcuts in a compact horizontal layout.
 */
function HelpScreen({ onClose }: { onClose: () => void }): ReactElement {

    const globalModes = useGlobalModes();
    const { isFocused } = useFocusScope('HelpScreen');

    // Read from the transport rather than from settings, so the line describes
    // what the terminal is actually in rather than what the file asked for.
    const { enabled: mouseEnabled } = useMouseTransport();

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

            {/*
                The escape hatch for the mouse. It is on unless a project turns
                it off, and turning it on takes click-drag text selection away
                from the terminal — a symptom a user reports as "text selection
                stopped working", which points at their terminal rather than at
                noorm. Naming the setting here is what closes that gap.
            */}
            <Box paddingX={1} paddingTop={1}>
                <Text dimColor>Mouse {mouseEnabled ? 'on' : 'off'}. </Text>
                <Text color="yellow">
                    ui.mouse: {mouseEnabled ? 'false' : 'true'}
                </Text>
                <Text dimColor>
                    {' '}in .noorm/settings.yml {mouseEnabled ? 'restores text selection' : 'enables clicks'}
                </Text>
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
    const { state: connState } = useConnectionContext();
    const { lockStatus } = useLockStatus();
    const globalModes = useGlobalModes();

    const configName = activeConfigName ?? 'none';
    const isConnected = connState.db !== null && !connState.error;
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
    const { showToast } = useToast();
    const { updateInfo, installing } = useUpdateChecker();
    const { rows: terminalHeight } = useWindowSize();

    // Show toast when update available (non-major updates)
    useEffect(() => {

        if (updateInfo?.updateAvailable && !updateInfo.isMajorUpdate && !installing) {

            showToast({
                message: `Update available: ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`,
                variant: 'info',
                duration: 8000,
            });

        }

    }, [updateInfo, installing, showToast]);

    // Show toast when major update available
    useEffect(() => {

        if (updateInfo?.updateAvailable && updateInfo.isMajorUpdate && !installing) {

            showToast({
                message: `Major update: ${updateInfo.latestVersion} (current: ${updateInfo.currentVersion})`,
                variant: 'warning',
                duration: 10000,
            });

        }

    }, [updateInfo, installing, showToast]);

    // Listen for update completion
    useOnEvent('update:complete', (data) => {

        showToast({
            message: `Updated to ${data.newVersion}. Restart to apply.`,
            variant: 'success',
            duration: 5000,
        });

    }, [showToast]);

    // Listen for update failure
    useOnEvent('update:failed', (data) => {

        showToast({
            message: `Update failed: ${data.error}`,
            variant: 'error',
            duration: 5000,
        });

    }, [showToast]);

    // Core reports failures it recovers from by emitting `error` and returning an
    // empty result — history reads, status lookups, and lock checks all do this.
    // `noorm ui` sends the logger's console and diagnostics streams to a null
    // stream, so without this subscription those failures reached nothing but
    // `.noorm/state/noorm.log`, and an operation that did nothing rendered as a
    // green success. Surfaced app-wide rather than per screen so a screen that
    // forgets to handle an error still cannot fail silently.
    useOnEvent('error', (data) => {

        showToast({
            message: `${data.source}: ${data.error.message}`,
            variant: 'error',
            duration: 8000,
        });

    }, [showToast]);

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
            {/* height, not minHeight: the shell owns the alternate screen, so it
                claims the full window instead of growing to fit its content. */}
            <Box
                flexDirection="column"
                height={terminalHeight}
                display={showHelp || showLogViewer ? 'none' : 'flex'}
            >
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

            {/* Hidden rather than unmounted: the shell claims the whole window,
                so an overlay drawn beside it would push the top out of reach.
                Unmounting instead would take the screen's state with it — the
                half-filled form you pressed ? from. */}
            {showHelp && <HelpScreen onClose={handleCloseHelp} />}

            {showLogViewer && <LogViewerOverlay onClose={handleToggleLogViewer} />}
        </GlobalKeyboard>
    );

}

/**
 * Turns the mouse transport on unless settings say not to.
 *
 * Separate from `MouseProvider` because the transport must not depend on the
 * app context: it has to be testable on its own, and the enable sequence has to
 * wait for the setting rather than for `render()`.
 *
 * `settings` is null while the managers load, and that is *unknown*, not
 * *absent* — absent is a loaded settings object with no `ui` section, which
 * `isMouseEnabled` reads as on. Waiting matters now that the default is on: a
 * project that wrote `ui: { mouse: false }` would otherwise spend every startup
 * with tracking enabled and its text selection broken, for a setting it
 * explicitly wrote. So the flag reads false first and flips once, which is
 * exactly when the escape sequence should go out.
 */
function MouseFromSettings({ children }: { children: ReactElement }): ReactElement {

    const { settings } = useSettings();

    return (
        <MouseProvider enabled={settings !== null && isMouseEnabled(settings)}>
            {children}
        </MouseProvider>
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
            <NoormObserver>
                <AppContextProvider projectRoot={projectRoot} autoLoad={autoLoad}>
                    <MouseFromSettings>
                        <ConnectionProvider>
                            <ToastProvider>
                                <FocusProvider>
                                    <RouterProvider initialRoute={initialRoute} initialParams={initialParams}>
                                        <AppShell />
                                    </RouterProvider>
                                </FocusProvider>
                            </ToastProvider>
                        </ConnectionProvider>
                    </MouseFromSettings>
                </AppContextProvider>
            </NoormObserver>
        </ShutdownProvider>
    );

}
