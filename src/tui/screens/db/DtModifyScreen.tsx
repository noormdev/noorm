/**
 * DtModifyScreen — modify .dt file columns and rows via recipe.
 *
 * Provides an interactive workflow to drop, add, rename columns
 * and filter rows from an existing .dt/.dtz/.dtzx file.
 *
 * @example
 * ```bash
 * noorm db transfer → Modify .dt file
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { DtSchema, DtValue, SimpleType } from '../../../core/dt/types.js';
import type { Recipe, ModifyResult } from '../../../core/dt/modify.js';

import { attempt, attemptSync } from '@logosdx/utils';

import { modifyDtFile, transformSchema, buildRowProxy } from '../../../core/dt/modify.js';
import { DtReader } from '../../../core/dt/reader.js';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAsyncEffect } from '../../hooks/index.js';
import { getErrorMessage } from '../../utils/index.js';
import {
    Confirm,
    Panel,
    Spinner,
    FilePicker,
    KeyHandler,
    TextInput,
    SelectList,
    useToast,
    type SelectListItem,
} from '../../components/index.js';

// ---------------------------------------------------------------------------
// Phase type
// ---------------------------------------------------------------------------

type Phase =
    | 'select-file'
    | 'passphrase'
    | 'show-columns'
    | 'operations'
    | 'op-drop'
    | 'op-add'
    | 'op-rename'
    | 'op-alter'
    | 'op-filter'
    | 'output'
    | 'confirm'
    | 'running'
    | 'complete'
    | 'error';

// ---------------------------------------------------------------------------
// Simple types for add-column cycling
// ---------------------------------------------------------------------------

const SIMPLE_TYPES: SimpleType[] = [
    'string', 'int', 'bigint', 'float', 'decimal', 'bool', 'timestamp', 'date', 'uuid',
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * DT Modify screen — recipe-based schema and row transformation.
 *
 * Walks the user through selecting a .dt file, viewing its schema,
 * building a recipe of column/row operations, and writing the output.
 *
 * @example
 * ```tsx
 * <DtModifyScreen params={{}} />
 * ```
 */
export function DtModifyScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('DtModifyScreen');
    const { showToast } = useToast();

    const [phase, setPhase] = useState<Phase>('select-file');
    const [error, setError] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [passphrase, setPassphrase] = useState('');
    const [sourceSchema, setSourceSchema] = useState<DtSchema | null>(null);
    const [sampleRow, setSampleRow] = useState<DtValue[] | null>(null);
    const [rowCount, setRowCount] = useState(0);
    const [recipe, setRecipe] = useState<Recipe>([]);
    const [availableDtFiles, setAvailableDtFiles] = useState<string[]>([]);
    const [scanningFiles, setScanningFiles] = useState(true);
    const [loadingSchema, setLoadingSchema] = useState(false);

    // Operations menu state
    const [showingSchema, setShowingSchema] = useState(false);

    // Add column state
    const [addName, setAddName] = useState('');
    const [addTypeIndex, setAddTypeIndex] = useState(0);
    const [addNullable, setAddNullable] = useState(true);
    const [addDefault, setAddDefault] = useState('');
    const [addFieldIndex, setAddFieldIndex] = useState(0);

    // Drop column state
    const [dropSelected, setDropSelected] = useState<Set<string>>(new Set());

    // Alter column state
    const [alterSelected, setAlterSelected] = useState<Set<string>>(new Set());

    // Rename column state
    const [renameStep, setRenameStep] = useState<'select' | 'input'>('select');
    const [renameFrom, setRenameFrom] = useState('');
    const [renameTo, setRenameTo] = useState('');

    // Filter rows state
    const [filterPredicate, setFilterPredicate] = useState('');
    const [filterTestResult, setFilterTestResult] = useState<string | null>(null);

    // Output state
    const [outputPath, setOutputPath] = useState('');
    const [overwriteOriginal, setOverwriteOriginal] = useState(false);

    // Result state
    const [modifyResult, setModifyResult] = useState<ModifyResult | null>(null);

    // -----------------------------------------------------------------------
    // File scanning
    // -----------------------------------------------------------------------

    useAsyncEffect(async (isCancelled) => {

        if (phase !== 'select-file') return;
        if (availableDtFiles.length > 0) return;

        setScanningFiles(true);

        const { readdir } = await import('fs/promises');
        const { join } = await import('path');

        const dtFiles: string[] = [];
        const ignoreDirs: { [k: string]: true } = {
            'node_modules': true,
            '.git': true,
            '.noorm': true,
            'dist': true,
            'build': true,
        };

        const scanDir = async (dir: string, prefix = ''): Promise<void> => {

            if (isCancelled()) return;

            const entries = await readdir(dir, { withFileTypes: true });

            for (const entry of entries) {

                if (isCancelled()) break;

                const fullPath = join(dir, entry.name);
                const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

                if (entry.isDirectory()) {

                    if (!ignoreDirs[entry.name] && !entry.name.startsWith('.')) {

                        await scanDir(fullPath, relativePath);

                    }

                }
                else if (entry.isFile()) {

                    const lower = entry.name.toLowerCase();

                    if (lower.endsWith('.dt') || lower.endsWith('.dtz') || lower.endsWith('.dtzx')) {

                        dtFiles.push(relativePath);

                    }

                }

            }

        };

        await scanDir(process.cwd());

        if (!isCancelled()) {

            setAvailableDtFiles(dtFiles.sort());
            setScanningFiles(false);

        }

    }, [phase, availableDtFiles.length]);

    // -----------------------------------------------------------------------
    // Schema loading
    // -----------------------------------------------------------------------

    useAsyncEffect(async (isCancelled) => {

        if (phase !== 'show-columns') return;
        if (!selectedFile) return;
        if (sourceSchema) return;

        setLoadingSchema(true);

        const reader = new DtReader({
            filepath: selectedFile,
            passphrase: passphrase || undefined,
        });

        const [, openErr] = await (async () => {

            const { attempt } = await import('@logosdx/utils');

            return attempt(() => reader.open());

        })();

        if (openErr) {

            if (!isCancelled()) {

                setError(`Failed to open DT file: ${getErrorMessage(openErr)}`);
                setPhase('error');
                setLoadingSchema(false);

            }

            return;

        }

        if (isCancelled()) {

            reader.close();

            return;

        }

        const schema = reader.schema!;
        let firstRow: DtValue[] | null = null;
        let count = 0;

        for await (const row of reader.rows()) {

            if (isCancelled()) break;

            count++;

            if (count === 1) {

                firstRow = row;

            }

        }

        reader.close();

        if (!isCancelled()) {

            setSourceSchema(schema);
            setSampleRow(firstRow);
            setRowCount(count);
            setLoadingSchema(false);

        }

    }, [phase, selectedFile, passphrase, sourceSchema]);

    // -----------------------------------------------------------------------
    // File selection handler
    // -----------------------------------------------------------------------

    const handleFileSelect = useCallback((files: string[]) => {

        if (files.length === 0) return;

        const file = files[0]!;
        setSelectedFile(file);
        setSourceSchema(null);
        setSampleRow(null);
        setRowCount(0);
        setRecipe([]);

        const lower = file.toLowerCase();

        if (lower.endsWith('.dtzx')) {

            setPhase('passphrase');

        }
        else {

            setPhase('show-columns');

        }

    }, []);

    // -----------------------------------------------------------------------
    // Passphrase input handler
    // -----------------------------------------------------------------------

    useInput((_input, key) => {

        if (phase !== 'passphrase') return;
        if (!isFocused) return;

        if (key.escape) {

            setPassphrase('');
            setSelectedFile(null);
            setPhase('select-file');

        }

        if (key.return && passphrase.trim()) {

            setPhase('show-columns');

        }

    });

    // -----------------------------------------------------------------------
    // Show-columns input handler
    // -----------------------------------------------------------------------

    useInput((_input, key) => {

        if (phase !== 'show-columns') return;
        if (!isFocused) return;
        if (loadingSchema) return;
        if (!sourceSchema) return;

        if (key.escape) {

            setSourceSchema(null);
            setSampleRow(null);
            setRowCount(0);
            setPassphrase('');
            setPhase('select-file');

        }

        if (key.return) {

            setPhase('operations');

        }

    });

    // -----------------------------------------------------------------------
    // Computed current schema (after recipe operations)
    // -----------------------------------------------------------------------

    const currentSchema = useMemo(() => {

        if (!sourceSchema) return null;

        return transformSchema(sourceSchema, recipe);

    }, [sourceSchema, recipe]);

    // -----------------------------------------------------------------------
    // Operations menu input handler
    // -----------------------------------------------------------------------

    useInput((input, key) => {

        if (phase !== 'operations') return;
        if (!isFocused) return;

        if (input === 'v') {

            setShowingSchema((prev) => !prev);

            return;

        }

        if (input === 'd') {

            setShowingSchema(false);
            setDropSelected(new Set());
            setPhase('op-drop');

            return;

        }

        if (input === 'a') {

            setShowingSchema(false);
            setAddName('');
            setAddTypeIndex(0);
            setAddNullable(true);
            setAddDefault('');
            setAddFieldIndex(0);
            setPhase('op-add');

            return;

        }

        if (input === 'r') {

            setShowingSchema(false);
            setRenameStep('select');
            setRenameFrom('');
            setRenameTo('');
            setPhase('op-rename');

            return;

        }

        if (input === 'n') {

            setShowingSchema(false);
            setAlterSelected(new Set());
            setPhase('op-alter');

            return;

        }

        if (input === 'f') {

            setShowingSchema(false);
            setFilterPredicate('');
            setFilterTestResult(null);
            setPhase('op-filter');

            return;

        }

        if (input === 'u' && recipe.length > 0) {

            setRecipe((prev) => prev.slice(0, -1));

            return;

        }

        if (key.return && recipe.length > 0) {

            if (selectedFile) {

                const dotIndex = selectedFile.lastIndexOf('.');
                const defaultOutput = dotIndex > 0
                    ? selectedFile.slice(0, dotIndex) + '_modified' + selectedFile.slice(dotIndex)
                    : selectedFile + '_modified';
                setOutputPath(defaultOutput);
                setOverwriteOriginal(false);

            }

            setPhase('output');

            return;

        }

        if (key.escape) {

            back();

        }

    });

    // -----------------------------------------------------------------------
    // Add column input handler
    // -----------------------------------------------------------------------

    useInput((input, key) => {

        if (phase !== 'op-add') return;
        if (!isFocused) return;

        if (key.escape) {

            setPhase('operations');

            return;

        }

        // Shift+Tab to move back — must be checked before plain Tab or it is unreachable
        if (key.tab && key.shift) {

            setAddFieldIndex((prev) => Math.max(prev - 1, 0));

            return;

        }

        // Tab to move between fields
        if (key.tab) {

            setAddFieldIndex((prev) => Math.min(prev + 1, 3));

            return;

        }

        // Field-specific handlers
        if (addFieldIndex === 1) {

            // Type cycling with up/down arrows
            if (key.upArrow) {

                setAddTypeIndex((prev) => (prev > 0 ? prev - 1 : SIMPLE_TYPES.length - 1));

                return;

            }

            if (key.downArrow) {

                setAddTypeIndex((prev) => (prev < SIMPLE_TYPES.length - 1 ? prev + 1 : 0));

                return;

            }

        }

        if (addFieldIndex === 2) {

            // Nullable toggle with space
            if (input === ' ') {

                setAddNullable((prev) => !prev);

                return;

            }

        }

        // Enter on last field or any field to submit
        if (key.return && addFieldIndex === 3 && addName.trim()) {

            const type = SIMPLE_TYPES[addTypeIndex]!;
            let defaultValue;

            if (/^NOW\(\)$/i.test(addDefault.trim())) {

                defaultValue = { kind: 'expression' as const, fn: 'NOW' as const };

            }
            else if (/^UUID\(\)$/i.test(addDefault.trim())) {

                defaultValue = { kind: 'expression' as const, fn: 'UUID' as const };

            }
            else {

                let parsed: unknown = addDefault;

                if (addDefault.trim()) {

                    const [jsonVal, jsonErr] = attemptSync(() => JSON.parse(addDefault));

                    if (!jsonErr) {

                        parsed = jsonVal;

                    }

                }

                defaultValue = { kind: 'literal' as const, value: parsed };

            }

            setRecipe((prev) => [
                ...prev,
                {
                    op: 'add',
                    column: addName.trim(),
                    type,
                    default: defaultValue,
                    nullable: addNullable,
                },
            ]);

            setAddName('');
            setAddTypeIndex(0);
            setAddNullable(true);
            setAddDefault('');
            setAddFieldIndex(0);
            setPhase('operations');

        }

    });

    // -----------------------------------------------------------------------
    // Rename column input handler (input step)
    // -----------------------------------------------------------------------

    useInput((_input, key) => {

        if (phase !== 'op-rename') return;
        if (!isFocused) return;
        if (renameStep !== 'input') return;

        if (key.escape) {

            setRenameStep('select');
            setRenameTo('');

            return;

        }

        if (key.return && renameTo.trim()) {

            setRecipe((prev) => [
                ...prev,
                { op: 'rename', from: renameFrom, to: renameTo.trim() },
            ]);

            setRenameStep('select');
            setRenameFrom('');
            setRenameTo('');
            setPhase('operations');

        }

    });

    // -----------------------------------------------------------------------
    // Filter rows input handler
    // -----------------------------------------------------------------------

    useInput((_input, key) => {

        if (phase !== 'op-filter') return;
        if (!isFocused) return;

        if (key.escape) {

            setFilterPredicate('');
            setFilterTestResult(null);
            setPhase('operations');

            return;

        }

        if (key.return && filterPredicate.trim()) {

            const [fn, compileErr] = attemptSync(
                () => new Function('row', 'return ' + filterPredicate) as (row: Record<string, unknown>) => boolean,
            );

            if (compileErr) {

                showToast({ message: `Invalid predicate: ${compileErr.message}`, variant: 'error' });

                return;

            }

            // Test against sample row if available.
            // Use sourceSchema (original) + sampleRow (original values) — currentSchema reflects
            // post-recipe columns while sampleRow holds pre-recipe values, so mixing them misaligns
            // the proxy. The test is syntax/runtime validation only, not exact result matching.
            if (sampleRow && sourceSchema) {

                const proxy = buildRowProxy(sourceSchema.columns, sampleRow);
                const [testVal, testErr] = attemptSync(() => fn!(proxy));

                if (testErr) {

                    setFilterTestResult(`Error: ${testErr.message}`);

                    return;

                }

                setFilterTestResult(`Test result: ${String(testVal)}`);

            }

            setRecipe((prev) => [
                ...prev,
                { op: 'filter', predicate: filterPredicate.trim() },
            ]);

            setFilterPredicate('');
            setFilterTestResult(null);
            setPhase('operations');

        }

    });

    // -----------------------------------------------------------------------
    // Output phase input handler
    // -----------------------------------------------------------------------

    useInput((input, key) => {

        if (phase !== 'output') return;
        if (!isFocused) return;

        if (key.escape) {

            setPhase('operations');

            return;

        }

        if (input === ' ') {

            setOverwriteOriginal((prev) => {

                const next = !prev;
                setOutputPath(next ? selectedFile! : (() => {

                    const dotIndex = selectedFile!.lastIndexOf('.');

                    return dotIndex > 0
                        ? selectedFile!.slice(0, dotIndex) + '_modified' + selectedFile!.slice(dotIndex)
                        : selectedFile! + '_modified';

                })());

                return next;

            });

            return;

        }

        if (key.return && outputPath.trim()) {

            setPhase('confirm');

        }

    });

    // -----------------------------------------------------------------------
    // Running phase async effect
    // -----------------------------------------------------------------------

    useAsyncEffect(async (isCancelled) => {

        if (phase !== 'running') return;
        if (!selectedFile) return;

        const [result, err] = await attempt(() => modifyDtFile({
            inputPath: selectedFile,
            outputPath,
            recipe,
            passphrase: passphrase || undefined,
        }));

        if (isCancelled()) return;

        if (err) {

            setError(getErrorMessage(err));
            setPhase('error');

            return;

        }

        const [modResult, modErr] = result!;

        if (modErr) {

            setError(getErrorMessage(modErr));
            setPhase('error');

            return;

        }

        setModifyResult(modResult);
        setPhase('complete');

    }, [phase, selectedFile, outputPath, recipe, passphrase]);

    // -----------------------------------------------------------------------
    // Error phase
    // -----------------------------------------------------------------------

    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="DtModifyError" onEscape={back} />
                <Panel title="Modify DT File - Error" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">{error}</Text>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Select file phase
    // -----------------------------------------------------------------------

    if (phase === 'select-file') {

        if (scanningFiles) {

            return (
                <Panel title="Modify DT File" paddingX={1} paddingY={1}>
                    <Spinner label="Scanning for .dt files..." />
                </Panel>
            );

        }

        if (availableDtFiles.length === 0) {

            return (
                <Box flexDirection="column" gap={1}>
                    <KeyHandler focusLabel="DtModifyEmpty" onEscape={back} />
                    <Panel title="Modify DT File" borderColor="yellow" paddingX={1} paddingY={1}>
                        <Text color="yellow">No .dt, .dtz, or .dtzx files found in the project.</Text>
                    </Panel>
                    <Box>
                        <Text dimColor>[Esc] Back</Text>
                    </Box>
                </Box>
            );

        }

        return (
            <FilePicker
                focusLabel="DtModifyFilePicker"
                files={availableDtFiles}
                onSelect={handleFileSelect}
                onCancel={back}
            />
        );

    }

    // -----------------------------------------------------------------------
    // Passphrase phase
    // -----------------------------------------------------------------------

    if (phase === 'passphrase') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Passphrase" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>This is an encrypted .dtzx file. Enter the decryption passphrase:</Text>
                        <Box gap={1}>
                            <Text>Passphrase:</Text>
                            <TextInput
                                defaultValue={passphrase}
                                onChange={setPassphrase}
                                placeholder="passphrase"
                            />
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter] Continue</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Show columns phase
    // -----------------------------------------------------------------------

    if (phase === 'show-columns') {

        if (loadingSchema || !sourceSchema) {

            return (
                <Panel title="Modify DT File - Schema" paddingX={1} paddingY={1}>
                    <Spinner label="Reading file schema..." />
                </Panel>
            );

        }

        const columns = sourceSchema.columns;
        const nameWidth = Math.max(6, ...columns.map(c => c.name.length)) + 2;
        const typeWidth = Math.max(6, ...columns.map(c => c.type.length)) + 2;
        const sourceTypeWidth = Math.max(12, ...columns.map(c => (c.sourceType ?? '').length)) + 2;

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Schema" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text dimColor>File:</Text>
                            <Text bold color="cyan">{selectedFile}</Text>
                        </Box>
                        <Box gap={2}>
                            <Text dimColor>Source:</Text>
                            <Text>{sourceSchema.d} {sourceSchema.dv}</Text>
                            {sourceSchema.t && (
                                <>
                                    <Text dimColor>Table:</Text>
                                    <Text>{sourceSchema.t}</Text>
                                </>
                            )}
                            <Text dimColor>Rows:</Text>
                            <Text bold>{rowCount.toLocaleString()}</Text>
                        </Box>

                        <Box flexDirection="column" marginTop={1}>
                            <Box>
                                <Text bold>
                                    {'  '}
                                    {'Name'.padEnd(nameWidth)}
                                    {'Type'.padEnd(typeWidth)}
                                    {'Nullable'.padEnd(10)}
                                    {'Source Type'.padEnd(sourceTypeWidth)}
                                </Text>
                            </Box>
                            <Box>
                                <Text dimColor>
                                    {'  '}
                                    {'─'.repeat(nameWidth)}
                                    {'─'.repeat(typeWidth)}
                                    {'─'.repeat(10)}
                                    {'─'.repeat(sourceTypeWidth)}
                                </Text>
                            </Box>
                            {columns.map((col) => (
                                <Box key={col.name}>
                                    <Text>
                                        {'  '}
                                        {col.name.padEnd(nameWidth)}
                                        {col.type.padEnd(typeWidth)}
                                        {(col.nullable !== false ? 'yes' : 'no').padEnd(10)}
                                        {(col.sourceType ?? '').padEnd(sourceTypeWidth)}
                                    </Text>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter] Modify</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Operations menu phase
    // -----------------------------------------------------------------------

    if (phase === 'operations') {

        const opItems: SelectListItem<string>[] = [
            { key: 'drop', label: '[d] Drop column', value: 'drop' },
            { key: 'add', label: '[a] Add column', value: 'add' },
            { key: 'rename', label: '[r] Rename column', value: 'rename' },
            { key: 'alter', label: '[n] Toggle nullable', value: 'alter' },
            { key: 'filter', label: '[f] Filter rows', value: 'filter' },
        ];

        const handleOpSelect = (item: SelectListItem<string>) => {

            setShowingSchema(false);

            if (item.value === 'drop') {

                setDropSelected(new Set());
                setPhase('op-drop');

            }
            else if (item.value === 'add') {

                setAddName('');
                setAddTypeIndex(0);
                setAddNullable(true);
                setAddDefault('');
                setAddFieldIndex(0);
                setPhase('op-add');

            }
            else if (item.value === 'rename') {

                setRenameStep('select');
                setRenameFrom('');
                setRenameTo('');
                setPhase('op-rename');

            }
            else if (item.value === 'alter') {

                setAlterSelected(new Set());
                setPhase('op-alter');

            }
            else if (item.value === 'filter') {

                setFilterPredicate('');
                setFilterTestResult(null);
                setPhase('op-filter');

            }

        };

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Operations" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>Choose an operation to add to the recipe:</Text>

                        <SelectList
                            items={opItems}
                            onSelect={handleOpSelect}
                            isFocused={isFocused}
                        />

                        {recipe.length > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text bold>Recipe ({recipe.length} operation{recipe.length !== 1 ? 's' : ''}):</Text>
                                {recipe.map((mod, i) => (
                                    <Box key={i}>
                                        <Text dimColor>  {i + 1}. </Text>
                                        {mod.op === 'drop' && <Text>Drop column <Text color="yellow">{mod.column}</Text></Text>}
                                        {mod.op === 'add' && (
                                            <Text>
                                                Add column <Text color="green">{mod.column}</Text>
                                                <Text dimColor> ({mod.type})</Text>
                                            </Text>
                                        )}
                                        {mod.op === 'rename' && (
                                            <Text>
                                                Rename <Text color="yellow">{mod.from}</Text>
                                                <Text dimColor> → </Text>
                                                <Text color="green">{mod.to}</Text>
                                            </Text>
                                        )}
                                        {mod.op === 'alter' && (
                                            <Text>
                                                Set <Text color="yellow">{mod.column}</Text>
                                                <Text dimColor> → </Text>
                                                <Text color={mod.nullable ? 'green' : 'red'}>{mod.nullable ? 'nullable' : 'not null'}</Text>
                                            </Text>
                                        )}
                                        {mod.op === 'filter' && (
                                            <Text>
                                                Filter: <Text color="cyan">{mod.predicate}</Text>
                                            </Text>
                                        )}
                                    </Box>
                                ))}
                            </Box>
                        )}

                        {showingSchema && currentSchema && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text bold>Current schema ({currentSchema.columns.length} columns):</Text>
                                {currentSchema.columns.map((col) => (
                                    <Box key={col.name}>
                                        <Text>
                                            {'  '}
                                            <Text color="cyan">{col.name}</Text>
                                            <Text dimColor> ({col.type}{col.nullable !== false ? ', nullable' : ''})</Text>
                                        </Text>
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[v] {showingSchema ? 'Hide' : 'View'} schema</Text>
                    {recipe.length > 0 && <Text dimColor>[u] Undo last</Text>}
                    {recipe.length > 0 && <Text dimColor>[Enter] Done — proceed to output</Text>}
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Drop column phase
    // -----------------------------------------------------------------------

    if (phase === 'op-drop') {

        const columns = currentSchema?.columns ?? [];
        const dropItems: SelectListItem<string>[] = columns.map((col) => ({
            key: col.name,
            label: `${dropSelected.has(col.name) ? '[x]' : '[ ]'} ${col.name} (${col.type})`,
            value: col.name,
        }));

        const handleDropToggle = (item: SelectListItem<string>) => {

            setDropSelected((prev) => {

                const next = new Set(prev);

                if (next.has(item.value)) {

                    next.delete(item.value);

                }
                else {

                    next.add(item.value);

                }

                return next;

            });

        };

        const handleDropSubmit = () => {

            if (dropSelected.size === 0) return;

            setRecipe((prev) => [
                ...prev,
                ...Array.from(dropSelected).map((col) => ({ op: 'drop' as const, column: col })),
            ]);
            setDropSelected(new Set());
            setPhase('operations');

        };

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Drop Columns" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>Select columns to drop ({dropSelected.size} selected):</Text>
                        <SelectList
                            items={dropItems}
                            multiSelect={true}
                            onToggle={handleDropToggle}
                            onSubmit={handleDropSubmit}
                            onCancel={() => {

                                setDropSelected(new Set()); setPhase('operations');

                            }}
                            focusLabel="DtModifyDropList"
                            reserveRows={2}
                        />
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Space] Toggle</Text>
                    <Text dimColor>[Enter] Drop selected</Text>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Add column phase
    // -----------------------------------------------------------------------

    if (phase === 'op-add') {

        const currentType = SIMPLE_TYPES[addTypeIndex]!;

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Add Column" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>Define the new column. Use Tab to move between fields.</Text>

                        <Box gap={1}>
                            <Text color={addFieldIndex === 0 ? 'cyan' : undefined} bold={addFieldIndex === 0}>
                                Name:
                            </Text>
                            {addFieldIndex === 0
                                ? (
                                    <TextInput
                                        defaultValue={addName}
                                        onChange={setAddName}
                                        placeholder="column_name"
                                    />
                                )
                                : <Text>{addName || <Text dimColor>column_name</Text>}</Text>
                            }
                        </Box>

                        <Box gap={1}>
                            <Text color={addFieldIndex === 1 ? 'cyan' : undefined} bold={addFieldIndex === 1}>
                                Type:
                            </Text>
                            <Text>{currentType}</Text>
                            {addFieldIndex === 1 && <Text dimColor> (↑/↓ to change)</Text>}
                        </Box>

                        <Box gap={1}>
                            <Text color={addFieldIndex === 2 ? 'cyan' : undefined} bold={addFieldIndex === 2}>
                                Nullable:
                            </Text>
                            <Text>{addNullable ? 'Yes' : 'No'}</Text>
                            {addFieldIndex === 2 && <Text dimColor> (Space to toggle)</Text>}
                        </Box>

                        <Box gap={1}>
                            <Text color={addFieldIndex === 3 ? 'cyan' : undefined} bold={addFieldIndex === 3}>
                                Default:
                            </Text>
                            {addFieldIndex === 3
                                ? (
                                    <TextInput
                                        defaultValue={addDefault}
                                        onChange={setAddDefault}
                                        placeholder="value, NOW(), or UUID()"
                                    />
                                )
                                : <Text>{addDefault || <Text dimColor>none</Text>}</Text>
                            }
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Tab] Next field</Text>
                    {addFieldIndex === 3 && addName.trim() && <Text dimColor>[Enter] Add column</Text>}
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Rename column phase
    // -----------------------------------------------------------------------

    if (phase === 'op-rename') {

        if (renameStep === 'select') {

            const columns = currentSchema?.columns ?? [];
            const renameItems: SelectListItem<string>[] = columns.map((col) => ({
                key: col.name,
                label: `${col.name} (${col.type})`,
                value: col.name,
            }));

            const handleRenameSelect = (item: SelectListItem<string>) => {

                setRenameFrom(item.value);
                setRenameTo('');
                setRenameStep('input');

            };

            return (
                <Box flexDirection="column" gap={1}>
                    <Panel title="Modify DT File - Rename Column" paddingX={1} paddingY={1}>
                        <Box flexDirection="column" gap={1}>
                            <Text dimColor>Select a column to rename:</Text>
                            <SelectList
                                items={renameItems}
                                onSelect={handleRenameSelect}
                                onCancel={() => setPhase('operations')}
                                focusLabel="DtModifyRenameList"
                                reserveRows={2}
                            />
                        </Box>
                    </Panel>
                    <Box>
                        <Text dimColor>[Esc] Back to operations</Text>
                    </Box>
                </Box>
            );

        }

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Rename Column" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={1}>
                            <Text dimColor>Renaming:</Text>
                            <Text bold color="yellow">{renameFrom}</Text>
                        </Box>
                        <Box gap={1}>
                            <Text>New name:</Text>
                            <TextInput
                                defaultValue={renameTo}
                                onChange={setRenameTo}
                                placeholder="new_column_name"
                            />
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    {renameTo.trim() && <Text dimColor>[Enter] Rename</Text>}
                    <Text dimColor>[Esc] Back to column list</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Alter column (toggle nullable) phase
    // -----------------------------------------------------------------------

    if (phase === 'op-alter') {

        const columns = currentSchema?.columns ?? [];
        const alterItems: SelectListItem<string>[] = columns.map((col) => {

            const isNullable = col.nullable !== false;
            const isToggled = alterSelected.has(col.name);
            const effectiveNullable = isToggled ? !isNullable : isNullable;

            return {
                key: col.name,
                label: `${effectiveNullable ? '[x]' : '[ ]'} ${col.name} (${col.type})`,
                value: col.name,
                description: isToggled ? `Will set to ${effectiveNullable ? 'nullable' : 'not null'}` : undefined,
            };

        });

        const handleAlterToggle = (item: SelectListItem<string>) => {

            setAlterSelected((prev) => {

                const next = new Set(prev);

                if (next.has(item.value)) {

                    next.delete(item.value);

                }
                else {

                    next.add(item.value);

                }

                return next;

            });

        };

        const handleAlterSubmit = () => {

            if (alterSelected.size === 0) return;

            setRecipe((prev) => [
                ...prev,
                ...Array.from(alterSelected).map((colName) => {

                    const col = columns.find(c => c.name === colName);
                    const currentNullable = col ? col.nullable !== false : true;

                    return { op: 'alter' as const, column: colName, nullable: !currentNullable };

                }),
            ]);
            setAlterSelected(new Set());
            setPhase('operations');

        };

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Toggle Nullable" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>Select columns to toggle nullable ({alterSelected.size} selected):</Text>
                        <SelectList
                            items={alterItems}
                            multiSelect={true}
                            onToggle={handleAlterToggle}
                            onSubmit={handleAlterSubmit}
                            onCancel={() => {

                                setAlterSelected(new Set()); setPhase('operations');

                            }}
                            focusLabel="DtModifyAlterList"
                            reserveRows={2}
                        />
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Space] Toggle</Text>
                    <Text dimColor>[Enter] Apply</Text>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Filter rows phase
    // -----------------------------------------------------------------------

    if (phase === 'op-filter') {

        const columns = currentSchema?.columns ?? [];

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Filter Rows" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>Enter a JS predicate expression. Rows where it returns true are kept.</Text>
                        <Box gap={1}>
                            <Text>Predicate:</Text>
                            <TextInput
                                defaultValue={filterPredicate}
                                onChange={setFilterPredicate}
                                placeholder="row.status === 'active'"
                            />
                        </Box>
                        {filterTestResult && (
                            <Text color={filterTestResult.startsWith('Error') ? 'red' : 'green'}>
                                {filterTestResult}
                            </Text>
                        )}
                        <Box flexDirection="column" marginTop={1}>
                            <Text dimColor>Available columns:</Text>
                            <Text dimColor>  {columns.map((c) => c.name).join(', ')}</Text>
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    {filterPredicate.trim() && <Text dimColor>[Enter] Add filter</Text>}
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Output phase — choose output file
    // -----------------------------------------------------------------------

    if (phase === 'output') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Output" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={1}>
                            <Text dimColor>Input:</Text>
                            <Text>{selectedFile}</Text>
                        </Box>
                        <Box gap={1}>
                            <Text>Output:</Text>
                            {overwriteOriginal
                                ? <Text color="yellow">{outputPath}</Text>
                                : (
                                    <TextInput
                                        defaultValue={outputPath}
                                        onChange={setOutputPath}
                                        placeholder="output.dt"
                                    />
                                )
                            }
                        </Box>
                        <Box gap={1}>
                            <Text dimColor>[Space]</Text>
                            <Text>{overwriteOriginal ? '[x]' : '[ ]'} Overwrite original</Text>
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    {outputPath.trim() && <Text dimColor>[Enter] Confirm</Text>}
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Confirm phase — recipe summary
    // -----------------------------------------------------------------------

    if (phase === 'confirm') {

        const transformedSchema = currentSchema;
        const originalColCount = sourceSchema?.columns.length ?? 0;
        const transformedColCount = transformedSchema?.columns.length ?? 0;

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Modify DT File - Confirm" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={1}>
                            <Text dimColor>Input:</Text>
                            <Text>{selectedFile}</Text>
                        </Box>
                        <Box gap={1}>
                            <Text dimColor>Output:</Text>
                            <Text color={overwriteOriginal ? 'yellow' : 'green'}>{outputPath}</Text>
                        </Box>

                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Operations ({recipe.length}):</Text>
                            {recipe.map((mod, i) => (
                                <Box key={i}>
                                    <Text dimColor>  {i + 1}. </Text>
                                    {mod.op === 'drop' && (
                                        <Text>Drop column: <Text color="yellow">{mod.column}</Text></Text>
                                    )}
                                    {mod.op === 'add' && (
                                        <Text>
                                            Add column: <Text color="green">{mod.column}</Text>
                                            <Text dimColor>
                                                {' '}({mod.type}, default: {mod.default.kind === 'expression'
                                                    ? `${mod.default.fn}()`
                                                    : String(mod.default.value ?? 'null')})
                                            </Text>
                                        </Text>
                                    )}
                                    {mod.op === 'rename' && (
                                        <Text>
                                            Rename column: <Text color="yellow">{mod.from}</Text>
                                            {' → '}
                                            <Text color="green">{mod.to}</Text>
                                        </Text>
                                    )}
                                    {mod.op === 'alter' && (
                                        <Text>
                                            Set <Text color="yellow">{mod.column}</Text>
                                            {' → '}
                                            <Text color={mod.nullable ? 'green' : 'red'}>{mod.nullable ? 'nullable' : 'not null'}</Text>
                                        </Text>
                                    )}
                                    {mod.op === 'filter' && (
                                        <Text>
                                            Filter rows: <Text color="cyan">{mod.predicate}</Text>
                                        </Text>
                                    )}
                                </Box>
                            ))}
                        </Box>

                        <Box marginTop={1}>
                            <Text dimColor>
                                {originalColCount} columns → {transformedColCount} columns
                            </Text>
                        </Box>
                    </Box>
                </Panel>

                <Confirm
                    message="Proceed with modification?"
                    title="Confirm"
                    focusLabel="DtModifyConfirm"
                    onConfirm={() => setPhase('running')}
                    onCancel={() => setPhase('operations')}
                />
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Running phase — execute modification
    // -----------------------------------------------------------------------

    if (phase === 'running') {

        return (
            <Panel title="Modify DT File - Running" paddingX={1} paddingY={1}>
                <Spinner label="Applying modifications..." />
            </Panel>
        );

    }

    // -----------------------------------------------------------------------
    // Complete phase — results summary
    // -----------------------------------------------------------------------

    if (phase === 'complete' && modifyResult) {

        const durationSec = (modifyResult.durationMs / 1000).toFixed(2);

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="DtModifyComplete" onEscape={back} />
                <Panel title="Modify DT File - Complete" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text bold color="green">Modification complete</Text>

                        <Box flexDirection="column" marginTop={1}>
                            <Box gap={1}>
                                <Text dimColor>Rows read:</Text>
                                <Text bold>{modifyResult.rowsRead.toLocaleString()}</Text>
                            </Box>
                            <Box gap={1}>
                                <Text dimColor>Rows written:</Text>
                                <Text bold>{modifyResult.rowsWritten.toLocaleString()}</Text>
                            </Box>
                            <Box gap={1}>
                                <Text dimColor>Rows filtered:</Text>
                                <Text bold>{modifyResult.rowsFiltered.toLocaleString()}</Text>
                            </Box>
                        </Box>

                        <Box flexDirection="column" marginTop={1}>
                            <Box gap={1}>
                                <Text dimColor>Columns dropped:</Text>
                                <Text bold>{modifyResult.columnsDropped}</Text>
                            </Box>
                            <Box gap={1}>
                                <Text dimColor>Columns added:</Text>
                                <Text bold>{modifyResult.columnsAdded}</Text>
                            </Box>
                            <Box gap={1}>
                                <Text dimColor>Columns renamed:</Text>
                                <Text bold>{modifyResult.columnsRenamed}</Text>
                            </Box>
                        </Box>

                        <Box gap={1} marginTop={1}>
                            <Text dimColor>Output:</Text>
                            <Text color="cyan">{modifyResult.outputPath}</Text>
                        </Box>
                        <Box gap={1}>
                            <Text dimColor>Duration:</Text>
                            <Text>{durationSec}s</Text>
                        </Box>
                    </Box>
                </Panel>
                <Box>
                    <Text dimColor>[Esc] Done</Text>
                </Box>
            </Box>
        );

    }

    // -----------------------------------------------------------------------
    // Fallback — should not be reached
    // -----------------------------------------------------------------------

    return (
        <Box flexDirection="column" gap={1}>
            <KeyHandler focusLabel="DtModifyFallback" onEscape={back} />
            <Panel title="Modify DT File" paddingX={1} paddingY={1}>
                <Text>Phase: {phase}</Text>
            </Panel>
            <Box>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
