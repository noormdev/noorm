/**
 * SQL Terminal Screen.
 *
 * Interactive SQL REPL for executing raw queries against the database.
 *
 * Features:
 * - Multi-line SQL input with edit mode
 * - Command history navigation (up/down arrows)
 * - Results displayed as filterable/sortable tables
 * - Query history persistence
 *
 * @example
 * ```bash
 * noorm db sql        # Opens SQL terminal
 * # Or press Shift+Q from anywhere
 * ```
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { Kysely } from 'kysely';
import type { ScreenProps } from '../../types.js';
import type { SqlExecutionResult, SqlHistoryEntry } from '../../../core/sql-terminal/types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, useToast } from '../../components/index.js';
import { SqlInput, ResultTable } from '../../components/terminal/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import { SqlHistoryManager, executeRawSql } from '../../../core/sql-terminal/index.js';

/**
 * Focus areas within the terminal.
 */
type FocusArea = 'input' | 'results';

/**
 * SQL Terminal Screen component.
 */
export function SqlTerminalScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SqlTerminal');
    const { activeConfig, activeConfigName, projectRoot } = useAppContext();
    const { showToast } = useToast();

    // State
    const [query, setQuery] = useState('');
    const [result, setResult] = useState<SqlExecutionResult | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [isConnecting, setIsConnecting] = useState(true);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [focusArea, setFocusArea] = useState<FocusArea>('input');

    // History state
    const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const historyManagerRef = useRef<SqlHistoryManager | null>(null);

    // Database connection ref
    const dbRef = useRef<Kysely<unknown> | null>(null);
    const destroyRef = useRef<(() => Promise<void>) | null>(null);

    // Load query from params if re-running from history
    useEffect(() => {

        if (params.name) {

            setQuery(params.name);

        }

    }, [params.name]);

    // Initialize connection and history
    useEffect(() => {

        if (!activeConfig || !activeConfigName || !projectRoot) {

            setIsConnecting(false);

            return;

        }

        let cancelled = false;

        const initialize = async () => {

            setIsConnecting(true);
            setConnectionError(null);

            // Test connection
            const testResult = await testConnection(activeConfig.connection);

            if (!testResult.ok) {

                if (!cancelled) {

                    setConnectionError(testResult.error ?? 'Connection failed');
                    setIsConnecting(false);

                }

                return;

            }

            // Create connection
            const [conn, connErr] = await attempt(() =>
                createConnection(activeConfig.connection, activeConfigName),
            );

            if (connErr || !conn) {

                if (!cancelled) {

                    setConnectionError(connErr?.message ?? 'Failed to connect');
                    setIsConnecting(false);

                }

                return;

            }

            if (cancelled) {

                await conn.destroy();

                return;

            }

            dbRef.current = conn.db;
            destroyRef.current = conn.destroy;

            // Initialize history manager
            historyManagerRef.current = new SqlHistoryManager(projectRoot, activeConfigName);

            // Load history
            const entries = await historyManagerRef.current.load();

            if (!cancelled) {

                setHistory(entries);
                setIsConnecting(false);

            }

        };

        initialize();

        return () => {

            cancelled = true;

            // Cleanup connection on unmount
            if (destroyRef.current) {

                destroyRef.current();
                dbRef.current = null;
                destroyRef.current = null;

            }

        };

    }, [activeConfig, activeConfigName, projectRoot]);

    // Execute query
    const handleExecute = useCallback(async (sql: string) => {

        if (!dbRef.current || !historyManagerRef.current || !activeConfigName) return;

        setIsExecuting(true);
        setResult(null);

        const execResult = await executeRawSql(dbRef.current, sql, activeConfigName);

        // Save to history
        await historyManagerRef.current.addEntry(sql, execResult);

        // Reload history
        const entries = await historyManagerRef.current.load();
        setHistory(entries);
        setHistoryIndex(-1);

        setResult(execResult);
        setIsExecuting(false);

        // Show toast for non-select queries
        if (execResult.success && execResult.rowsAffected !== undefined) {

            showToast({
                message: `${execResult.rowsAffected} row(s) affected`,
                variant: 'success',
            });

        }
        else if (!execResult.success) {

            showToast({
                message: execResult.errorMessage ?? 'Query failed',
                variant: 'error',
            });

        }

        // Clear input on success
        if (execResult.success) {

            setQuery('');

        }

    }, [activeConfigName, showToast]);

    // Navigate history
    const handleHistoryNavigate = useCallback((direction: 'up' | 'down') => {

        if (history.length === 0) return;

        if (direction === 'up') {

            // Move to older query
            const newIndex = historyIndex + 1;
            const entry = history[newIndex];

            if (newIndex < history.length && entry) {

                setHistoryIndex(newIndex);
                setQuery(entry.query);

            }

        }
        else {

            // Move to newer query
            const newIndex = historyIndex - 1;
            const entry = history[newIndex];

            if (newIndex >= 0 && entry) {

                setHistoryIndex(newIndex);
                setQuery(entry.query);

            }
            else if (newIndex === -1) {

                setHistoryIndex(-1);
                setQuery('');

            }

        }

    }, [history, historyIndex]);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused || isExecuting) return;

        // Tab: Switch focus between input and results
        if (key.tab && !key.shift && result?.rows && result.rows.length > 0) {

            setFocusArea((area) => (area === 'input' ? 'results' : 'input'));

            return;

        }

        // h: Open history screen
        if (input === 'h' && focusArea === 'input') {

            navigate('db/sql/history');

            return;

        }

        // Escape: Back (if input focused) or switch to input (if results focused)
        if (key.escape) {

            if (focusArea === 'results') {

                setFocusArea('input');

            }
            else {

                back();

            }

            return;

        }

    });

    // No active config
    if (!activeConfig || !activeConfigName) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="SQL Terminal" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No active configuration selected.</Text>
                        <Text dimColor>Select a configuration first using the config screen.</Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Connecting
    if (isConnecting) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="SQL Terminal" paddingX={1} paddingY={1}>
                    <Spinner label="Connecting to database..." />
                </Panel>
            </Box>
        );

    }

    // Connection error
    if (connectionError) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="SQL Terminal" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Connection failed</Text>
                        <Text dimColor>{connectionError}</Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <Box gap={2}>
                <Text bold>SQL Terminal</Text>
                <Text dimColor>-</Text>
                <Text color="cyan">{activeConfigName}</Text>
                {historyIndex >= 0 && (
                    <>
                        <Text dimColor>|</Text>
                        <Text dimColor>History [{historyIndex + 1}/{history.length}]</Text>
                    </>
                )}
            </Box>

            {/* Results area */}
            {result && (
                <Panel
                    title={result.success ? 'Results' : 'Error'}
                    borderColor={result.success ? undefined : 'red'}
                    paddingX={1}
                    paddingY={1}
                >
                    {result.success && result.columns && result.rows ? (
                        <ResultTable
                            columns={result.columns}
                            rows={result.rows}
                            active={focusArea === 'results'}
                            onEscape={() => setFocusArea('input')}
                        />
                    ) : result.success && result.rowsAffected !== undefined ? (
                        <Text color="green">
                            {result.rowsAffected} row(s) affected ({result.durationMs.toFixed(0)}ms)
                        </Text>
                    ) : result.success ? (
                        <Text dimColor>Query executed successfully ({result.durationMs.toFixed(0)}ms)</Text>
                    ) : (
                        <Text color="red">{result.errorMessage}</Text>
                    )}
                </Panel>
            )}

            {/* Executing indicator */}
            {isExecuting && (
                <Panel title="Executing" paddingX={1} paddingY={1}>
                    <Spinner label="Running query..." />
                </Panel>
            )}

            {/* Input area */}
            <Panel
                title="Query"
                borderColor={focusArea === 'input' ? 'cyan' : undefined}
                paddingX={1}
                paddingY={1}
            >
                <SqlInput
                    value={query}
                    onChange={setQuery}
                    onSubmit={handleExecute}
                    onHistoryNavigate={handleHistoryNavigate}
                    disabled={isExecuting}
                    active={focusArea === 'input'}
                />
            </Panel>

            {/* Footer hints */}
            <Box gap={2}>
                <Text dimColor>[h] History</Text>
                {result?.rows && result.rows.length > 0 && (
                    <Text dimColor>[Tab] {focusArea === 'input' ? 'Results' : 'Input'}</Text>
                )}
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
