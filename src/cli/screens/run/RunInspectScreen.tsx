/**
 * RunInspectScreen - inspect template context variables.
 *
 * Shows what data files, helpers, and built-ins are available
 * for a template file without executing it.
 *
 * @example
 * ```bash
 * noorm run inspect           # Opens this screen
 * noorm run inspect sql/users/001_create.sql.tmpl  # With pre-filled path
 * ```
 */
import { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { join, relative } from 'path';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useSettings, useAppContext } from '../../app-context.js';
import { Panel, Spinner, SearchableList } from '../../components/index.js';
import { discoverFiles } from '../../../core/runner/index.js';
import { buildContext } from '../../../core/template/context.js';
import { processFile } from '../../../core/template/engine.js';
import { attempt } from '@logosdx/utils';

import type { SelectListItem } from '../../components/index.js';
import type { TemplateContext } from '../../../core/template/types.js';

type Phase = 'loading' | 'picker' | 'inspecting' | 'expanded' | 'preview' | 'error';

// Built-in helper names (always present in context)
const BUILTIN_HELPERS = new Set(['quote', 'escape', 'uuid', 'now', 'json', 'include']);
const STANDARD_KEYS = new Set(['config', 'secrets', 'globalSecrets', 'env']);

interface CategorizedContext {
    dataFiles: Array<{ key: string; value: unknown }>;
    helpers: Array<{ key: string; value: unknown }>;
    builtins: Array<{ key: string; value: unknown }>;
    config: unknown;
    secrets: Record<string, string>;
    globalSecrets: Record<string, string>;
    env: Record<string, string | undefined>;
}

/**
 * Describe a value's type for display.
 */
function describeType(value: unknown): string {

    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    if (Array.isArray(value)) return `Array [${value.length}]`;

    if (typeof value === 'function') return 'Function';

    if (typeof value === 'object') {

        const keys = Object.keys(value);
        const preview = keys.slice(0, 4).join(', ');
        const suffix = keys.length > 4 ? ', ...' : '';

        return `Object {${preview}${suffix}}`;

    }

    if (typeof value === 'string') {

        const truncated = value.length > 20 ? value.slice(0, 20) + '...' : value;

        return `"${truncated}"`;

    }

    return String(value);

}

/**
 * Get the shape of array items (union of all object keys).
 */
function getArrayShape(arr: unknown[]): string {

    if (arr.length === 0) return 'empty';

    const shapes = new Set<string>();
    let hasPrimitives = false;

    for (const item of arr) {

        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {

            Object.keys(item).forEach(k => shapes.add(k));

        }
        else {

            hasPrimitives = true;
            shapes.add(typeof item);

        }

    }

    const keys = [...shapes];

    if (hasPrimitives && keys.every(k => ['string', 'number', 'boolean', 'undefined'].includes(k))) {

        return keys.length === 1 ? keys[0] ?? 'mixed' : 'mixed';

    }

    return `{${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', ...' : ''}}`;

}

/**
 * Describe a value's type with deep shape info for expanded view.
 */
function describeTypeExpanded(value: unknown, indent = 0): string[] {

    const pad = '  '.repeat(indent);

    if (value === null) return [`${pad}null`];
    if (value === undefined) return [`${pad}undefined`];

    if (Array.isArray(value)) {

        const shape = getArrayShape(value);

        return [`${pad}Array [${value.length}] of ${shape}`];

    }

    if (typeof value === 'function') return [`${pad}Function`];

    if (typeof value === 'object') {

        const lines: string[] = [`${pad}Object`];
        const entries = Object.entries(value);

        for (const [key, val] of entries.slice(0, 10)) {

            if (Array.isArray(val)) {

                const shape = getArrayShape(val);
                lines.push(`${pad}  ${key}: Array [${val.length}] of ${shape}`);

            }
            else if (typeof val === 'object' && val !== null) {

                const objKeys = Object.keys(val).slice(0, 4);
                const suffix = Object.keys(val).length > 4 ? ', ...' : '';
                lines.push(`${pad}  ${key}: Object {${objKeys.join(', ')}${suffix}}`);

            }
            else if (typeof val === 'function') {

                lines.push(`${pad}  ${key}: Function`);

            }
            else {

                lines.push(`${pad}  ${key}: ${typeof val}`);

            }

        }

        if (entries.length > 10) {

            lines.push(`${pad}  ... (${entries.length - 10} more)`);

        }

        return lines;

    }

    return [`${pad}${typeof value}`];

}

/**
 * Categorize context properties into groups.
 */
function categorizeContext(ctx: TemplateContext): CategorizedContext {

    const dataFiles: Array<{ key: string; value: unknown }> = [];
    const helpers: Array<{ key: string; value: unknown }> = [];
    const builtins: Array<{ key: string; value: unknown }> = [];

    for (const [key, value] of Object.entries(ctx)) {

        if (STANDARD_KEYS.has(key)) continue;

        if (BUILTIN_HELPERS.has(key)) {

            builtins.push({ key, value });
            continue;

        }

        if (typeof value === 'function') {

            helpers.push({ key, value });

        }
        else {

            dataFiles.push({ key, value });

        }

    }

    return {
        dataFiles: dataFiles.sort((a, b) => a.key.localeCompare(b.key)),
        helpers: helpers.sort((a, b) => a.key.localeCompare(b.key)),
        builtins: builtins.sort((a, b) => a.key.localeCompare(b.key)),
        config: ctx.config,
        secrets: ctx.secrets,
        globalSecrets: ctx.globalSecrets,
        env: ctx.env,
    };

}

/**
 * Component that handles keyboard input for a specific focus scope.
 */
function KeyHandler({
    focusLabel,
    onEscape,
    onKey,
}: {
    focusLabel: string;
    onEscape?: () => void;
    onKey?: (input: string, key: { escape: boolean }) => void;
}): null {

    const { isFocused } = useFocusScope(focusLabel);

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape && onEscape) {

            onEscape();

            return;

        }

        if (onKey) {

            onKey(input, key);

        }

    });

    return null;

}

/**
 * RunInspectScreen component.
 */
export function RunInspectScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { activeConfig, activeConfigName, stateManager } = useAppContext();
    const { settings } = useSettings();

    const [phase, setPhase] = useState<Phase>('loading');
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(params.path ?? null);
    const [context, setContext] = useState<CategorizedContext | null>(null);
    const [renderedSql, setRenderedSql] = useState<string | null>(null);
    const [renderDuration, setRenderDuration] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const projectRoot = process.cwd();

    // Load template files on mount
    useEffect(() => {

        if (!settings) return;

        let cancelled = false;

        const load = async () => {

            setPhase('loading');

            const sqlPath = settings.paths?.sql ?? 'sql';
            const sqlFullPath = join(projectRoot, sqlPath);

            const [files, err] = await attempt(() => discoverFiles(sqlFullPath));

            if (cancelled) return;

            if (err) {

                setError(`Failed to discover files: ${err.message}`);
                setPhase('error');

                return;

            }

            // Filter to only .sql.tmpl files
            const templates = (files ?? []).filter(f => f.endsWith('.sql.tmpl'));
            setAllFiles(templates);

            // If pre-filled path provided, validate and go to inspecting
            if (params.path) {

                const fullPath = join(projectRoot, params.path);
                const found = templates.find((f) =>
                    f === fullPath || relative(projectRoot, f) === params.path,
                );

                if (found) {

                    setSelectedFile(found);
                    // Will trigger loadContext effect

                }

            }

            setPhase('picker');

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [settings, projectRoot, params.path]);

    // Load context when file is selected
    const loadContext = useCallback(async () => {

        if (!selectedFile || !stateManager) return;

        setPhase('loading');
        setError(null);

        const [ctx, err] = await attempt(() => buildContext(selectedFile, {
            projectRoot,
            config: activeConfig as unknown as Record<string, unknown>,
            secrets: stateManager.getAllSecrets(activeConfigName ?? ''),
            globalSecrets: stateManager.getAllGlobalSecrets(),
        }));

        if (err) {

            setError(`Failed to load context: ${err.message}`);
            setPhase('error');

            return;

        }

        if (ctx) {

            setContext(categorizeContext(ctx));
            setPhase('inspecting');

        }

    }, [selectedFile, projectRoot, activeConfig, activeConfigName, stateManager]);

    // Effect to load context when file changes
    useEffect(() => {

        if (selectedFile && phase === 'picker') {

            loadContext();

        }

    }, [selectedFile, loadContext, phase]);

    // Handle file selection
    const handleSelect = useCallback((item: SelectListItem<string>) => {

        setSelectedFile(item.value);
        setContext(null);
        setRenderedSql(null);
        setRenderDuration(null);
        loadContext();

    }, [loadContext]);

    // Handle preview SQL
    const handlePreview = useCallback(async () => {

        if (!selectedFile || !stateManager) return;

        setPhase('loading');
        setError(null);

        const [result, err] = await attempt(() => processFile(selectedFile, {
            projectRoot,
            config: activeConfig as unknown as Record<string, unknown>,
            secrets: stateManager.getAllSecrets(activeConfigName ?? ''),
            globalSecrets: stateManager.getAllGlobalSecrets(),
        }));

        if (err) {

            setError(err.stack ?? err.message);
            setPhase('preview');

            return;

        }

        if (result) {

            setRenderedSql(result.sql);
            setRenderDuration(result.durationMs ?? null);
            setPhase('preview');

        }

    }, [selectedFile, projectRoot, activeConfig, activeConfigName, stateManager]);

    // Handle refresh
    const handleRefresh = useCallback(() => {

        loadContext();

    }, [loadContext]);

    // Create file items for SearchableList
    const fileItems: SelectListItem<string>[] = allFiles.map((file) => {

        const relativePath = relative(projectRoot, file);

        return {
            key: file,
            label: relativePath,
            value: file,
        };

    });

    // Handlers for inspecting phase
    const handleInspectKey = useCallback((input: string) => {

        if (input === 'e') {

            setPhase('expanded');

        }
        else if (input === 'p') {

            handlePreview();

        }
        else if (input === 'r') {

            handleRefresh();

        }

    }, [handlePreview, handleRefresh]);

    const handleInspectEscape = useCallback(() => {

        setSelectedFile(null);
        setContext(null);
        setPhase('picker');

    }, []);

    const handleBackToInspect = useCallback(() => {

        setPhase('inspecting');

    }, []);

    const displayPath = selectedFile ? relative(projectRoot, selectedFile) : '';

    // Loading
    if (phase === 'loading') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Inspect Template" paddingX={1} paddingY={1}>
                    <Spinner label="Loading..." />
                </Panel>
            </Box>
        );

    }

    // Error (for context loading errors)
    if (phase === 'error' && !selectedFile) {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="ErrorEscape" onEscape={back} />
                <Panel title="Inspect Template" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Error</Text>
                        <Text dimColor>{error}</Text>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Picker
    if (phase === 'picker') {

        const hasFiles = allFiles.length > 0;
        const sqlPath = settings?.paths?.sql ?? 'sql';

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Select Template" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        {hasFiles ? (
                            <>
                                <Text dimColor>
                                    Select a template file to inspect
                                </Text>
                                <Box flexDirection="column" height={15}>
                                    <SearchableList
                                        focusLabel="InspectFilePicker"
                                        items={fileItems}
                                        onSelect={handleSelect}
                                        onCancel={back}
                                        visibleCount={10}
                                        searchPlaceholder="Filter templates..."
                                        emptyLabel="No template files found"
                                    />
                                </Box>
                            </>
                        ) : (
                            <>
                                <KeyHandler focusLabel="ErrorEscape" onEscape={back} />
                                <Box flexDirection="column" gap={1}>
                                    <Text color="yellow">No template files found in {sqlPath}/</Text>
                                    <Text dimColor>
                                        Templates must end with .sql.tmpl extension.
                                    </Text>
                                </Box>
                            </>
                        )}
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    {hasFiles && (
                        <>
                            <Text dimColor>[/] Search</Text>
                            <Text dimColor>[Enter] Select</Text>
                        </>
                    )}
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Inspecting
    if (phase === 'inspecting' && context) {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="InspectActions"
                    onEscape={handleInspectEscape}
                    onKey={handleInspectKey}
                />
                <Panel title="Template Context" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>File:</Text>
                            <Text bold color="cyan">{displayPath}</Text>
                        </Box>

                        {context.dataFiles.length > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text bold>Data Files</Text>
                                {context.dataFiles.map(({ key, value }) => (
                                    <Box key={key} marginLeft={2} gap={1}>
                                        <Box width={24}>
                                            <Text color="green">$.{key}</Text>
                                        </Box>
                                        <Text dimColor>{describeType(value)}</Text>
                                    </Box>
                                ))}
                            </Box>
                        )}

                        {context.helpers.length > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text bold>Helpers</Text>
                                {context.helpers.map(({ key }) => (
                                    <Box key={key} marginLeft={2} gap={1}>
                                        <Box width={24}>
                                            <Text color="magenta">$.{key}</Text>
                                        </Box>
                                        <Text dimColor>Function</Text>
                                    </Box>
                                ))}
                            </Box>
                        )}

                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Built-ins</Text>
                            {context.builtins.map(({ key }) => (
                                <Box key={key} marginLeft={2} gap={1}>
                                    <Box width={24}>
                                        <Text color="blue">$.{key}</Text>
                                    </Box>
                                    <Text dimColor>Function</Text>
                                </Box>
                            ))}
                        </Box>

                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Config</Text>
                            <Box marginLeft={2} gap={1}>
                                <Box width={24}>
                                    <Text color="yellow">$.config</Text>
                                </Box>
                                <Text dimColor>
                                    {context.config ? describeType(context.config) : '(not set)'}
                                </Text>
                            </Box>
                        </Box>

                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Secrets</Text>
                            <Box marginLeft={2} gap={1}>
                                <Box width={24}>
                                    <Text color="red">$.secrets</Text>
                                </Box>
                                <Text dimColor>
                                    Object ({Object.keys(context.secrets).length} keys)
                                </Text>
                            </Box>
                            <Box marginLeft={2} gap={1}>
                                <Box width={24}>
                                    <Text color="red">$.globalSecrets</Text>
                                </Box>
                                <Text dimColor>
                                    Object ({Object.keys(context.globalSecrets).length} keys)
                                </Text>
                            </Box>
                        </Box>

                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Environment</Text>
                            <Box marginLeft={2} gap={1}>
                                <Box width={24}>
                                    <Text dimColor>$.env</Text>
                                </Box>
                                <Text dimColor>
                                    Object ({Object.keys(context.env).length} keys)
                                </Text>
                            </Box>
                        </Box>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[e] Expand</Text>
                    <Text dimColor>[p] Preview SQL</Text>
                    <Text dimColor>[r] Refresh</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Expanded
    if (phase === 'expanded' && context) {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="ExpandedActions"
                    onEscape={handleBackToInspect}
                />
                <Panel title="Expanded Context" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>File:</Text>
                            <Text bold color="cyan">{displayPath}</Text>
                        </Box>

                        {context.dataFiles.map(({ key, value }) => (
                            <Box key={key} flexDirection="column" marginTop={1}>
                                <Text color="green" bold>$.{key}</Text>
                                {describeTypeExpanded(value, 1).map((line, i) => (
                                    <Text key={i} dimColor>{line}</Text>
                                ))}
                            </Box>
                        ))}

                        {context.config !== undefined && context.config !== null && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text color="yellow" bold>$.config</Text>
                                {describeTypeExpanded(context.config, 1).map((line, i) => (
                                    <Text key={i} dimColor>{line}</Text>
                                ))}
                            </Box>
                        )}
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back to summary</Text>
                </Box>
            </Box>
        );

    }

    // Preview (with possible error)
    if (phase === 'preview') {

        const hasError = error !== null;

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="PreviewActions"
                    onEscape={handleBackToInspect}
                />
                <Panel
                    title={hasError ? 'Render Error' : 'Rendered SQL'}
                    borderColor={hasError ? 'red' : undefined}
                    paddingX={1}
                    paddingY={1}
                >
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>File:</Text>
                            <Text bold color="cyan">{displayPath}</Text>
                        </Box>

                        {!hasError && renderDuration !== null && (
                            <Box gap={2}>
                                <Text>Rendered in:</Text>
                                <Text dimColor>{renderDuration.toFixed(1)}ms</Text>
                            </Box>
                        )}

                        <Box flexDirection="column" marginTop={1}>
                            {hasError ? (
                                <Text color="red">{error}</Text>
                            ) : (
                                <Text>{renderedSql}</Text>
                            )}
                        </Box>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back to summary</Text>
                </Box>
            </Box>
        );

    }

    return <Text>Unknown phase</Text>;

}
