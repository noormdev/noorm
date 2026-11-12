import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { attempt, attemptSync } from '@logosdx/utils';
import { Box, Text, useInput } from 'ink';
import type { ScreenProps } from '../../types.js';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { useAsyncEffect } from '../../hooks/index.js';
import { usePipelineOperations } from '../../hooks/usePipelineOperations.js';
import { Panel, Spinner, TextOverlay } from '../../components/index.js';
import { Form } from '../../components/forms/Form.js';
import type { PipelineHistoryRecord } from '../../../core/pipeline/history.js';
import { parseRunId } from '../../../core/pipeline/parse.js';
import { oneLine } from '../../utils/string.js';
import { PipelineEvidence } from './helpers.js';
import { HotkeyLine } from '../../components/layout/Hotkey.js';

function dependencies(raw: string): number[] {

    const [parsed] = attemptSync((): unknown => JSON.parse(raw));

    return Array.isArray(parsed) && parsed.every((item) => Number.isSafeInteger(item) && item > 0) ? parsed : [];

}

/**
 * One recorded run looked up by run ID, the identifier the CLI prints, so a run seen in CI output
 * can be inspected in the TUI. Unsafe IDs are rejected before any lookup.
 *
 * @example
 * navigate('pipeline/history/detail', { pipelineRunId: 42 });
 */
export function PipelineHistoryDetailScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { activeConfigName } = useAppContext();
    const operations = usePipelineOperations();
    const { connection, target } = operations;
    const [runId, setRunId] = useState(params.pipelineRunId);
    const [lookup, setLookup] = useState(!params.pipelineRunId || parseRunId(String(params.pipelineRunId)) === null);
    const [record, setRecord] = useState<PipelineHistoryRecord | null>(null);
    const [inspection, setInspection] = useState<string | null>(null);
    const [selection, setSelection] = useState<{ target: typeof target; runId: typeof runId; key?: string }>({ target, runId });
    if (selection.target !== target || selection.runId !== runId) {

        setSelection({ target, runId, key: '' });

    }
    const { isFocused } = useFocusScope({ label: 'Pipeline run detail', skip: lookup });
    useEffect(() => {

        setInspection(null);

    }, [target, runId]);
    const [loadedTarget, setLoadedTarget] = useState(target);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const query = `${runId}:${refresh}`;
    const [settledQuery, setSettledQuery] = useState<string | null>(null);
    useAsyncEffect(async (cancelled) => {

        setSettledQuery(null);

        setRecord(null);
        setError(false);
        if (!target || !runId || lookup) {

            setLoading(false);

            return;

        }
        setLoading(true);
        const [found, runError] = await attempt(() => operations.getRun(runId));
        if (cancelled()) return;
        if (runError) setError(true);
        else {

            setRecord(found);

        }
        setLoadedTarget(target);
        setSettledQuery(query);
        setLoading(false);

    }, [target, runId, lookup, refresh]);
    useInput((input, key) => {

        if (!isFocused || lookup || inspection !== null) return;
        if (key.escape) back();
        if (input === 'i') setLookup(true);
        if (input === 'r') setRefresh((current) => current + 1);
        if (input === 'd' && loadedTarget === target && record) setInspection([
            `Pipeline: ${record.run.slug}`,
            `Configuration: ${activeConfigName ?? 'none'}`,
            `Run ID: ${record.run.id}`,
            `Execution status: ${record.run.status}`,
            `Transaction outcome: ${record.run.transaction_outcome}`,
            `Transaction: ${record.run.transaction_policy}`,
            `Single run: ${record.run.single_run ? 'protected' : 'off'}`,
        ].join('\n'));

    });
    if (inspection !== null) return <TextOverlay title="Pipeline evidence" text={inspection} onClose={() => setInspection(null)} />;
    if (lookup) return <Panel title="Pipeline run ID lookup" paddingX={1}>
        <Form key={runId ?? 'lookup'} fields={[{ key: 'id', label: 'Run ID', type: 'text', defaultValue: runId ? String(runId) : '',
            validate: (value) => parseRunId(value) !== null ? undefined : 'Enter a positive safe whole-number run ID' }]}
        submitLabel="Look up" onCancel={() => runId && parseRunId(String(runId)) !== null ? setLookup(false) : back()}
        onSubmit={(values) => {

            setRunId(Number(values['id'])); setLookup(false);

        }} />
    </Panel>;
    const current = loadedTarget === target ? record : null;

    return <Panel title={`Pipeline run #${runId}`} paddingX={1}>
        <Box flexDirection="column">
            <Text dimColor wrap="truncate">Configuration: {oneLine(activeConfigName ?? 'none')}</Text>
            {connection.loading || loading || (target && (loadedTarget !== target || settledQuery !== query)) ? <Spinner label="Loading pipeline run..." />
                : !target ? <Text color="yellow">Select a ready database configuration to read history.</Text>
                    : error ? <Text color="red">Unable to read this pipeline run in the selected configuration.</Text>
                        : !current ? <Text color="yellow">Run not found in this configuration.</Text> : <>
                            <Text wrap="truncate">{oneLine(current.run.slug)} · Transaction: {current.run.transaction_policy} · Single run: {current.run.single_run ? 'protected' : 'off'}</Text>
                            <PipelineEvidence runId={current.run.id} status={current.run.status} outcome={current.run.transaction_outcome}
                                isFocused={isFocused} onInspect={setInspection}
                                defaultValue={selection.target === target && selection.runId === runId ? selection.key : ''}
                                onHighlight={(step) => setSelection((currentSelection) => currentSelection.target === target
                                    && currentSelection.runId === runId && currentSelection.key === String(step.stepNo)
                                    ? currentSelection : { target, runId, key: String(step.stepNo) })}
                                steps={current.steps.map((step) => ({ stepNo: step.step_no, name: step.name, needs: dependencies(step.needs),
                                    status: step.status, outcome: step.transaction_outcome }))} />
                        </>}
            <HotkeyLine>[Enter] Step details · [d] Evidence · [i] ID lookup</HotkeyLine>
            <HotkeyLine>[r] Refresh · [Esc] Back</HotkeyLine>
        </Box>
    </Panel>;

}
