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
import { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { join, relative } from 'path';

import type { ReactElement } from 'react';
import type { Kysely } from 'kysely';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useSettings, useAppContext } from '../../app-context.js';
import { Panel, Spinner, SearchableList } from '../../components/index.js';
import { ScrollPane, rowBudget, wrapText } from '../../components/terminal/index.js';
import { useAsyncEffect, useConnection, viewportRows } from '../../hooks/index.js';
import { maskSecret } from '../../../core/shared/index.js';
import { discoverFiles } from '../../../core/runner/index.js';
import { buildContext } from '../../../core/template/context.js';
import { processFile } from '../../../core/template/engine.js';
import { loadHelpers, type HelperLoadError } from '../../../core/template/helpers.js';
import { getVaultKey, buildSecretsContext } from '../../../core/vault/index.js';
import { loadIdentityMetadata, loadPrivateKey } from '../../../core/identity/storage.js';
import { attempt } from '@logosdx/utils';

import type { SelectListItem } from '../../components/index.js';
import type { TemplateContext } from '../../../core/template/types.js';
import type { Dialect } from '../../../core/connection/types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { StateManager } from '../../../core/state/index.js';

type Phase = 'loading' | 'picker' | 'inspecting' | 'expanded' | 'preview' | 'error';

// Built-in helper names (always present in context)
const BUILTIN_HELPERS = new Set(['quote', 'escape', 'uuid', 'now', 'json', 'include']);
const STANDARD_KEYS = new Set(['config', 'secrets', 'globalSecrets', 'env']);

/**
 * Rows a scrolling phase spends inside its Panel before the pane starts.
 *
 * The `File:` line and the gap under it. The file name stays out of the pane on
 * purpose: it is the one thing a reader needs at every scroll position, and a
 * heading that scrolls away is a heading that is missing when it is wanted.
 */
const HEADER_ROWS = 2;

/**
 * A template context split into the groups the screen draws as sections.
 *
 * Exported because the line builders below are unit-tested directly, the way
 * `ExploreDetailScreen`'s row builders are — rendering the whole screen to
 * assert on a mask would mean standing up a project, a config and a connection
 * for a pure function.
 *
 * @example
 * const lines = contextLines(categorizeContext(ctx, helperKeys, []), projectRoot, 96);
 */
export interface CategorizedContext {
    dataFiles: Array<{ key: string; value: unknown }>;
    helpers: Array<{ key: string; value: unknown }>;
    helperErrors: HelperLoadError[];
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
 *
 * Uses helperKeys (from loadHelpers) to categorize by source
 * rather than guessing by type. This ensures non-function helper
 * exports (constants, arrays, objects) show under Helpers.
 */
function categorizeContext(ctx: TemplateContext, helperKeys: Set<string>, helperErrors: HelperLoadError[]): CategorizedContext {

    const dataFiles: Array<{ key: string; value: unknown }> = [];
    const helpers: Array<{ key: string; value: unknown }> = [];
    const builtins: Array<{ key: string; value: unknown }> = [];

    for (const [key, value] of Object.entries(ctx)) {

        if (STANDARD_KEYS.has(key)) continue;

        if (BUILTIN_HELPERS.has(key)) {

            builtins.push({ key, value });
            continue;

        }

        if (helperKeys.has(key)) {

            helpers.push({ key, value });

        }
        else {

            dataFiles.push({ key, value });

        }

    }

    return {
        dataFiles: dataFiles.sort((a, b) => a.key.localeCompare(b.key)),
        helpers: helpers.sort((a, b) => a.key.localeCompare(b.key)),
        helperErrors,
        builtins: builtins.sort((a, b) => a.key.localeCompare(b.key)),
        config: ctx.config,
        secrets: ctx.secrets,
        globalSecrets: ctx.globalSecrets,
        env: ctx.env,
    };

}

/**
 * Resolve `$.secrets` through all three tiers for the shared connection.
 *
 * Inspect must show what apply would actually see — a preview reading
 * different secrets than `run file`/`run build` use is the exact silent
 * divergence this fixes. Falls back to the local-only tiers when
 * disconnected, no identity is on disk, or the vault key can't be
 * decrypted; only `noorm vault *` screens treat that as an error.
 */
async function resolveRenderSecrets(
    stateManager: StateManager,
    configName: string,
    db: Kysely<NoormDatabase> | null,
    dialect: Dialect | null,
): Promise<Record<string, string>> {

    if (!db || !dialect) return buildSecretsContext(stateManager, configName);

    const [vaultKey] = await attempt(async () => {

        const cryptoIdentity = await loadIdentityMetadata();
        const privateKey = cryptoIdentity ? await loadPrivateKey() : null;

        if (!cryptoIdentity || !privateKey) return null;

        return getVaultKey(db, cryptoIdentity.identityHash, privateKey, dialect);

    });

    return buildSecretsContext(stateManager, configName, db, vaultKey, dialect);

}

/** Widest the name column grows before it truncates. */
const NAME_CAP = 30;

/** Narrowest the name column shrinks to, however little the terminal offers. */
const NAME_MIN = 12;

/** Left inset every entry under a section heading shares. */
const ENTRY_INDENT = 2;

/**
 * Width of the name column, derived from what this context actually holds.
 *
 * Same idiom as the explore rows and the Form label gutter: size once from the
 * content, cap it, truncate past the cap. A context of short names does not pay
 * for the one environment variable with a sixty-character name.
 */
function nameColumnWidth(names: string[], budget: number): number {

    let widest = 0;

    for (const name of names) {

        if (name.length > widest) widest = name.length;

    }

    return Math.max(NAME_MIN, Math.min(widest, NAME_CAP, budget - ENTRY_INDENT - NAME_MIN));

}

/**
 * Text with its line breaks flattened, so it can occupy exactly one row.
 *
 * `wrap="truncate"` bounds a line's width, not its height: Ink still breaks on
 * an embedded newline, so a single `<Text>` holding one draws two rows and puts
 * the viewport's arithmetic out by one for everything below it. Nothing on this
 * screen controls the strings it displays — a secret can be a PEM key, an
 * environment variable can hold anything, a helper's error message can be a
 * multi-line diagnostic — so the flattening happens where text enters a
 * one-row cell rather than at each of those sources.
 */
function oneLine(text: string): string {

    return text.replace(/[\r\n]+/g, ' ');

}

/**
 * One `name  detail` line, exactly one row tall.
 *
 * `flexShrink={0}` on the name cell because Ink's `width` is a flex basis and
 * flex items shrink by default: without it a long detail squeezes the name on
 * that row alone, and the column wanders down the page. Both cells truncate
 * rather than wrap, which bounds their width; `oneLine` is what bounds their
 * height.
 */
function entryRow(key: string, name: string, color: string, detail: string, width: number): ReactElement {

    return (
        <Box key={key} marginLeft={ENTRY_INDENT} gap={1}>
            <Box width={width} flexShrink={0}>
                <Text color={color} wrap="truncate">{oneLine(name)}</Text>
            </Box>
            <Text dimColor wrap="truncate">{oneLine(detail)}</Text>
        </Box>
    );

}

/**
 * A heading, its entries, and the blank line under them.
 *
 * An empty section contributes nothing rather than a bare heading, so a project
 * with no data files does not scroll past a promise of some.
 */
function sectionLines(key: string, title: string, rows: ReactElement[]): ReactElement[] {

    if (rows.length === 0) return [];

    return [
        <Text key={`${key}:title`} bold wrap="truncate">{title}</Text>,
        ...rows,
        <Text key={`${key}:end`}> </Text>,
    ];

}

/**
 * Secret keys, each with as much of its value as is safe to show.
 *
 * A count answers "is anything there". The question this screen is actually
 * asked is "did this template get the value I think it got", and only the value
 * answers that — a stale password and a fresh one are both `Object (7 keys)`.
 * How much of it is safe to show is `maskSecret`'s decision, not this
 * component's; see `core/shared/mask.ts`. The length rides alongside as a
 * number rather than as mask width so that "set but empty" and "set to the
 * wrong 8-character value" stay distinguishable without the asterisks
 * themselves leaking anything.
 */
function secretRows(prefix: string, values: Record<string, string | undefined>, color: string, width: number): ReactElement[] {

    return Object.keys(values).sort().map((key) => {

        const value = values[key] ?? '';

        // Code points, matching how `maskSecret` counts. Reporting UTF-16 units
        // beside a mask banded on characters would call the same value two
        // different lengths.
        const count = [...value].length;

        return entryRow(`${prefix}:${key}`, key, color, `${maskSecret(value)}  (${count} chars)`, width);

    });

}

/**
 * The summary view as one element per visual line.
 *
 * Flattened rather than nested because Ink has no scroll offset: the only way
 * to reach content past the bottom of the terminal is to draw a slice of a flat
 * list, and a tree cannot be sliced.
 *
 * `$.env` is listed and masked like the other two secret tiers. It is the whole
 * of `process.env` (`core/template/context.ts`), which on a developer's machine
 * routinely carries tokens that never went near noorm's vault, and nothing here
 * can tell which of its keys those are. Masking every value is the answer that
 * is wrong in the harmless direction.
 *
 * @example
 * <ScrollPane lines={contextLines(context, projectRoot, rowBudget(columns))} … />
 */
export function contextLines(context: CategorizedContext, projectRoot: string, budget: number): ReactElement[] {

    const envKeys = Object.keys(context.env);
    const width = nameColumnWidth(
        [
            ...context.dataFiles.map(({ key }) => `$.${key}`),
            ...context.helpers.map(({ key }) => `$.${key}`),
            ...context.builtins.map(({ key }) => `$.${key}`),
            ...Object.keys(context.secrets),
            ...Object.keys(context.globalSecrets),
            ...envKeys,
            '$.config',
        ],
        budget,
    );

    // A helper error gets the whole row rather than the two-column treatment.
    // The name column is sized from the `$.name` entries beside it, which are
    // short, and a path is the one thing this row exists to say — put it in
    // that column and `sql/helpers/slug.js` renders as `sql/helpers…`, naming
    // no file at all.
    const helperEntries = [
        ...context.helpers.map(({ key, value }) =>
            entryRow(`helper:${key}`, `$.${key}`, 'magenta', describeType(value), width)),
        ...context.helperErrors.map(({ filepath, error }) => (
            <Text key={`helperError:${filepath}`} color="red" wrap="truncate">
                {oneLine(`${' '.repeat(ENTRY_INDENT)}${relative(projectRoot, filepath)} — ${error.message}`)}
            </Text>
        )),
    ];

    return [
        ...sectionLines('data', 'Data Files', context.dataFiles.map(({ key, value }) =>
            entryRow(`data:${key}`, `$.${key}`, 'green', describeType(value), width))),
        ...sectionLines('helpers', 'Helpers ($helpers)', helperEntries),
        ...sectionLines('builtins', 'Built-ins', context.builtins.map(({ key }) =>
            entryRow(`builtin:${key}`, `$.${key}`, 'blue', 'Function', width))),
        ...sectionLines('config', 'Config', [
            entryRow('config', '$.config', 'yellow', context.config ? describeType(context.config) : '(not set)', width),
        ]),
        ...sectionLines(
            'secrets',
            `Secrets ($.secrets — ${Object.keys(context.secrets).length})`,
            secretRows('secret', context.secrets, 'red', width),
        ),
        ...sectionLines(
            'globalSecrets',
            `Global Secrets ($.globalSecrets — ${Object.keys(context.globalSecrets).length})`,
            secretRows('globalSecret', context.globalSecrets, 'red', width),
        ),
        ...sectionLines(
            'env',
            `Environment ($.env — ${envKeys.length})`,
            secretRows('env', context.env, 'gray', width),
        ),
    ];

}

/**
 * Plain text as one element per visual line.
 *
 * Wrapped here rather than left to Ink because a `<Text>` that wraps itself
 * occupies however many rows the terminal decides, and the viewport has to know
 * the count before Ink lays it out.
 */
function textLines(key: string, text: string, budget: number, style: { color?: string; dim?: boolean } = {}): ReactElement[] {

    return wrapText(text, budget).map((line, index) => (
        <Text key={`${key}:${index}`} color={style.color} dimColor={style.dim}>{line}</Text>
    ));

}

/**
 * The expanded view as one element per visual line.
 *
 * Reports shapes rather than values, so what can overflow a row here is a long
 * key or a wide shape summary, and both are wrapped to the budget rather than
 * truncated — the expanded view exists to show what a summary cut.
 *
 * @example
 * <ScrollPane lines={expandedLines(context, rowBudget(columns))} … />
 */
export function expandedLines(context: CategorizedContext, budget: number): ReactElement[] {

    const lines: ReactElement[] = [];

    for (const { key, value } of context.dataFiles) {

        lines.push(<Text key={`exp:${key}`} color="green" bold wrap="truncate">{oneLine(`$.${key}`)}</Text>);
        lines.push(...describeTypeExpanded(value, 1).flatMap((line, index) =>
            textLines(`exp:${key}:${index}`, line, budget, { dim: true })));
        lines.push(<Text key={`exp:${key}:end`}> </Text>);

    }

    if (context.config !== undefined && context.config !== null) {

        lines.push(<Text key="exp:config" color="yellow" bold wrap="truncate">$.config</Text>);
        lines.push(...describeTypeExpanded(context.config, 1).flatMap((line, index) =>
            textLines(`exp:config:${index}`, line, budget, { dim: true })));

    }

    return lines;

}

/**
 * RunInspectScreen component.
 */
export function RunInspectScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { activeConfig, activeConfigName, stateManager } = useAppContext();
    const { settings } = useSettings();
    const { db, dialect } = useConnection();

    // useWindowSize, not useStdout: stdout.columns and .rows mutate on resize
    // without telling React, so anything derived from them would freeze at
    // mount size. Above the early returns, or the hook count changes once the
    // load resolves.
    const { columns: terminalColumns, rows: terminalRows } = useWindowSize();

    const [phase, setPhase] = useState<Phase>('loading');
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(params.path ?? null);
    const [context, setContext] = useState<CategorizedContext | null>(null);
    const [renderedSql, setRenderedSql] = useState<string | null>(null);
    const [renderDuration, setRenderDuration] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    // One scope for the whole screen rather than one per phase, because the
    // scroll pane and the action keys have to agree on who is focused and two
    // scopes cannot: React runs a child's effects before its parent's, so a
    // screen-level push lands *above* its own child's and takes the keys the
    // child was mounted to receive. `skip` is how a screen that sometimes hosts
    // a focusable child stays out of the stack while that child is up — here,
    // the file picker's `SearchableList`.
    const { isFocused } = useFocusScope({
        label: 'RunInspect',
        skip: phase === 'picker' && allFiles.length > 0,
    });

    const projectRoot = process.cwd();

    // Load template files on mount
    useAsyncEffect(async (isCancelled) => {

        if (!settings) return;

        setPhase('loading');

        const sqlPath = settings.paths?.sql ?? 'sql';
        const sqlFullPath = join(projectRoot, sqlPath);

        const [files, err] = await attempt(() => discoverFiles(sqlFullPath));

        if (isCancelled()) return;

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

    }, [settings, projectRoot, params.path]);

    // Load context when file is selected
    const loadContext = useCallback(async () => {

        if (!selectedFile || !stateManager) return;

        setPhase('loading');
        setError(null);

        const templateDir = selectedFile.substring(0, selectedFile.lastIndexOf('/'));

        const [results, err] = await attempt(async () => {

            const [secrets, helperResult] = await Promise.all([
                resolveRenderSecrets(stateManager, activeConfigName ?? '', db, dialect),
                loadHelpers(templateDir, projectRoot),
            ]);

            const ctx = await buildContext(selectedFile, {
                projectRoot,
                config: activeConfig as unknown as Record<string, unknown>,
                secrets,
                globalSecrets: stateManager.getAllGlobalSecrets(),
            });

            return {
                ctx,
                helperKeys: new Set(Object.keys(helperResult.helpers)),
                helperErrors: helperResult.errors,
            };

        });

        if (err) {

            setError(`Failed to load context: ${err.message}`);
            setPhase('error');

            return;

        }

        if (results) {

            setContext(categorizeContext(results.ctx, results.helperKeys, results.helperErrors));
            setPhase('inspecting');

        }

    }, [selectedFile, projectRoot, activeConfig, activeConfigName, stateManager, db, dialect]);

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

        const secrets = await resolveRenderSecrets(stateManager, activeConfigName ?? '', db, dialect);

        const [result, err] = await attempt(() => processFile(selectedFile, {
            projectRoot,
            config: activeConfig as unknown as Record<string, unknown>,
            secrets,
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

    }, [selectedFile, projectRoot, activeConfig, activeConfigName, stateManager, db, dialect]);

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

    const handleInspectEscape = useCallback(() => {

        setSelectedFile(null);
        setContext(null);
        setError(null);
        setPhase('picker');

    }, []);

    const displayPath = selectedFile ? relative(projectRoot, selectedFile) : '';

    const paneHeight = viewportRows(terminalRows, HEADER_ROWS);
    const budget = rowBudget(terminalColumns);

    const summaryLines = useMemo(
        () => (context ? contextLines(context, projectRoot, budget) : []),
        [context, projectRoot, budget],
    );

    const detailLines = useMemo(
        () => (context ? expandedLines(context, budget) : []),
        [context, budget],
    );

    // The render error and the rendered SQL share the pane, because they are
    // the same thing to a reader: what came back from asking for this template.
    // A stack trace overflows a terminal as readily as a schema does.
    const previewLines = useMemo(
        () => (error !== null
            ? textLines('previewError', error, budget, { color: 'red' })
            : textLines('preview', renderedSql ?? '', budget)),
        [error, renderedSql, budget],
    );

    const errorLines = useMemo(
        () => textLines('error', error ?? 'Unknown error', budget, { dim: true }),
        [error, budget],
    );

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            // An error raised against a chosen template goes back to the
            // picker, like a successful inspection does. Only a failure to
            // discover any templates at all leaves the screen, because there is
            // no picker to go back to.
            if (phase === 'inspecting' || (phase === 'error' && selectedFile)) handleInspectEscape();
            else if (phase === 'expanded' || phase === 'preview') setPhase('inspecting');
            else back();

            return;

        }

        if (phase !== 'inspecting') return;

        // Ink reports a Ctrl chord as the bare letter with `key.ctrl` set, so
        // without this Ctrl+E would expand and Ctrl+R would re-render. Ctrl+D
        // is safe either way — it arrives as `d`, which none of these match —
        // but the pane below reads it, so the modifier check has to happen
        // before any of them.
        if (key.ctrl || key.meta) return;

        if (input === 'e') setPhase('expanded');

        if (input === 'p') handlePreview();

        if (input === 'r') handleRefresh();

    });

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

    // Error, from discovering the file list or from building the context.
    //
    // Both, deliberately: this used to require `!selectedFile`, which is true
    // only of a discovery failure, so a template whose helper threw set
    // `phase: 'error'` with a file selected and fell through every branch to
    // "Unknown phase" — the one error a reader is most likely to hit was the
    // one the screen would not show.
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Inspect Template" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red" wrap="truncate">Error{displayPath ? `: ${displayPath}` : ''}</Text>
                        <ScrollPane lines={errorLines} height={paneHeight} isFocused={isFocused} />
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[↑↓] Scroll</Text>
                    <Text dimColor>[^U/^D] Half</Text>
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
                                <SearchableList
                                    focusLabel="InspectFilePicker"
                                    items={fileItems}
                                    onSelect={handleSelect}
                                    onCancel={back}
                                    reserveRows={2}
                                    searchPlaceholder="Filter templates..."
                                    emptyLabel="No template files found"
                                />
                            </>
                        ) : (
                            <>
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
                <Panel title="Template Context" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text wrap="truncate">
                            <Text>File: </Text>
                            <Text bold color="cyan">{displayPath}</Text>
                        </Text>
                        <ScrollPane lines={summaryLines} height={paneHeight} isFocused={isFocused} />
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[↑↓] Scroll</Text>
                    <Text dimColor>[^U/^D] Half</Text>
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
                <Panel title="Expanded Context" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text wrap="truncate">
                            <Text>File: </Text>
                            <Text bold color="cyan">{displayPath}</Text>
                        </Text>
                        <ScrollPane lines={detailLines} height={paneHeight} isFocused={isFocused} />
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[↑↓] Scroll</Text>
                    <Text dimColor>[^U/^D] Half</Text>
                    <Text dimColor>[Esc] Back to summary</Text>
                </Box>
            </Box>
        );

    }

    // Preview (with possible error)
    if (phase === 'preview') {

        const hasError = error !== null;
        const timing = renderDuration !== null ? ` · ${renderDuration.toFixed(1)}ms` : '';

        return (
            <Box flexDirection="column" gap={1}>
                <Panel
                    title={hasError ? 'Render Error' : 'Rendered SQL'}
                    borderColor={hasError ? 'red' : undefined}
                    paddingX={1}
                    paddingY={1}
                >
                    <Box flexDirection="column" gap={1}>
                        <Text wrap="truncate">
                            <Text>File: </Text>
                            <Text bold color="cyan">{displayPath}</Text>
                            <Text dimColor>{hasError ? '' : timing}</Text>
                        </Text>
                        <ScrollPane lines={previewLines} height={paneHeight} isFocused={isFocused} />
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[↑↓] Scroll</Text>
                    <Text dimColor>[^U/^D] Half</Text>
                    <Text dimColor>[Esc] Back to summary</Text>
                </Box>
            </Box>
        );

    }

    return <Text>Unknown phase</Text>;

}
