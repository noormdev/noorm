import { readdir, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import { attempt } from '@logosdx/utils';
import { loadPipelineDefinition } from '../../../core/pipeline/definition.js';
import { PipelineDefinitionError, type PipelineDefinitionRule } from '../../../core/pipeline/errors.js';
import { isWithinRoot } from '../../../core/template/utils.js';
import type { PipelineDefinition, PipelineInputDeclaration, PipelineJsonValue } from '../../../core/pipeline/types.js';
import { SelectList } from '../../components/index.js';
import { oneLine } from '../../utils/string.js';

export interface PipelineEntry {
    slug: string;
    definition: PipelineDefinition | null;
    /** The definition rule that failed, when the load failed on one. */
    rule?: PipelineDefinitionRule;
}

/**
 * Lists every pipeline folder, keeping invalid ones as entries with their failed rule,
 * so a broken manifest shows up in the list instead of disappearing.
 *
 * @example
 * const entries = await discoverPipelineDefinitions(projectRoot, 'db/pipelines');
 * const runnable = entries.filter((entry) => entry.definition !== null);
 */
export async function discoverPipelineDefinitions(projectRoot: string, pipelinesPath: string): Promise<PipelineEntry[]> {

    const root = await realpath(projectRoot);
    const configured = resolve(root, pipelinesPath);
    if (isAbsolute(pipelinesPath) || !isWithinRoot(configured, root)) throw new Error('Invalid pipelines root');
    const [directory, resolveError] = await attempt(() => realpath(configured));

    if (resolveError) {

        if ('code' in resolveError && resolveError.code === 'ENOENT') return [];
        throw new Error('Unable to discover pipelines', { cause: resolveError });

    }
    if (!isWithinRoot(directory, root)) throw new Error('Invalid pipelines root');
    const entries = await readdir(directory, { withFileTypes: true });

    return Promise.all(entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => {

            const [definition, failure] = await attempt(
                () => loadPipelineDefinition({ projectRoot, pipelinesPath, slug: entry.name }),
            );
            if (definition) return { slug: entry.name, definition };

            return failure instanceof PipelineDefinitionError
                ? { slug: entry.name, definition: null, rule: failure.rule }
                : { slug: entry.name, definition: null };

        }));

}

/**
 * Labels where an input's value will come from without showing the value, which can be sensitive.
 *
 * @example
 * inputPresence('cutoff', { type: 'string', required: true }, {}); // 'Unset'
 */
export function inputPresence(name: string, declaration: PipelineInputDeclaration, overrides: Record<string, PipelineJsonValue>): string {

    if (Object.hasOwn(overrides, name)) return 'Supplied';
    if (Object.hasOwn(declaration, 'default')) return 'Default';

    return declaration.required ? 'Unset' : 'Omitted';

}

/**
 * The one test for a clean result, so no screen shows `success` with an `unknown` or `partial` outcome as green.
 *
 * @example
 * pipelineResultIsClean('success', 'unknown'); // false
 */
export function pipelineResultIsClean(status: string, outcome: string): boolean {

    return status === 'success' && (outcome === 'committed' || outcome === 'no_effects');

}

/**
 * One-line heading that truncates, so a long slug cannot push the screen past the terminal height.
 *
 * @example
 * <PipelineHeading>{`Pipeline: ${slug}`}</PipelineHeading>
 */
export function PipelineHeading({ children }: { children: string }): ReactElement {

    return <Box marginBottom={1}>
        <Text bold color="cyan" wrap="truncate">{oneLine(children)}</Text>
    </Box>;

}

export interface PipelineEvidenceStep {
    stepNo: number;
    name: string;
    status?: string;
    outcome?: string;
    needs?: readonly number[];
    error?: { phase: string; stepNo?: number } | null;
}

/**
 * Shared run evidence for the run and history screens. It shows status, outcome, steps and error phases,
 * never stored error text, so a fresh result and a recorded run look the same.
 *
 * @example
 * <PipelineEvidence runId={run.id} status={run.status} outcome={run.transaction_outcome} steps={steps} onInspect={setInspection} />
 */
export function PipelineEvidence({ status, outcome, runId, steps, cleanupFailed = false, isFocused = true, defaultValue, onHighlight, onInspect }: {
    status: string;
    outcome: string;
    runId: number | null;
    steps: PipelineEvidenceStep[];
    cleanupFailed?: boolean;
    isFocused?: boolean;
    defaultValue?: string;
    onHighlight?: (step: PipelineEvidenceStep) => void;
    onInspect?: (text: string) => void;
}): ReactElement {

    const [selectedKey, setSelectedKey] = useState(defaultValue);
    const orderedSteps = [...steps].sort((a, b) => a.stepNo - b.stepNo);
    const selected = orderedSteps.find((step) => String(step.stepNo) === selectedKey) ?? orderedSteps[0];
    const color = !cleanupFailed && pipelineResultIsClean(status, outcome) ? 'green' : 'yellow';
    const phases = ['execute', 'commit', 'rollback', 'audit', 'cleanup', 'interrupted'];

    return <Box flexDirection="column">
        <Text>Run ID: {runId ?? 'none (dry run)'}</Text>
        <Text color={color}>Execution status: {status} · Transaction outcome: {outcome}</Text>
        {!pipelineResultIsClean(status, outcome) && <Text color="yellow">Not a confirmed clean success.</Text>}
        <SelectList items={orderedSteps.map((step) => ({
            key: String(step.stepNo), value: step,
            label: `${step.stepNo}. ${oneLine(step.name)}${step.status ? ` · ${step.status}` : ''}${step.outcome ? ` · ${step.outcome}` : ''}`,
        }))} defaultValue={defaultValue} focusLabel="Pipeline evidence steps" onHighlight={(item) => {

            setSelectedKey(item.key);
            onHighlight?.(item.value);

        }} isFocused={isFocused} reserveRows={7}
        renderItem={(item, state) => <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate" color={state.isHighlighted && state.isFocused ? 'cyan' : undefined}>{item.label}</Text>
        </Box>}
        onSelect={(item) => onInspect?.([
            `Step ${item.value.stepNo}: ${oneLine(item.value.name)}`,
            `Execution status: ${item.value.status ?? 'not executed (dry run)'}`,
            `Transaction outcome: ${item.value.outcome ?? 'no_effects'}`,
            `Dependencies: ${item.value.needs?.join(', ') || 'none'}`,
            ...(item.value.error && phases.includes(item.value.error.phase)
                ? [`Error phase: ${item.value.error.phase}${item.value.error.stepNo === undefined ? '' : ` · Step ${item.value.error.stepNo}`}`] : []),
        ].join('\n'))} />
        <Text dimColor wrap="truncate">Dependencies: {selected?.needs?.join(', ') || 'none'}</Text>
        {selected?.error && phases.includes(selected.error.phase) && <Text color="yellow">
            Error phase: {selected.error.phase}{selected.error.stepNo === undefined ? '' : ` · Step ${selected.error.stepNo}`}
        </Text>}
    </Box>;

}
