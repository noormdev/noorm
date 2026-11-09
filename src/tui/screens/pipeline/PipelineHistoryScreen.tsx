import { useState } from 'react';
import type { ReactElement } from 'react';
import { attempt } from '@logosdx/utils';
import { Box, Text, useInput } from 'ink';
import type { ScreenProps } from '../../types.js';
import { useRouter } from '../../router.js';
import { useFocusContext, useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { useAsyncEffect } from '../../hooks/index.js';
import { usePipelineOperations } from '../../hooks/usePipelineOperations.js';
import { Panel, SelectList, Spinner, TextOverlay } from '../../components/index.js';
import { Form } from '../../components/forms/Form.js';
import type { NoormPipelineRun } from '../../../core/shared/tables.js';
import { isPipelineSlug, parseHistoryLimit } from '../../../core/pipeline/parse.js';
import { oneLine } from '../../utils/string.js';
import { PipelineHeading } from './helpers.js';

/**
 * Recorded runs for one slug on the active config. It takes a slug with no local definition,
 * so history stays reachable after a pipeline folder is renamed or deleted.
 *
 * @example
 * navigate('pipeline/history', { pipelineSlug: 'refresh' });
 */
export function PipelineHistoryScreen({ params }: ScreenProps): ReactElement {

    const { back, navigate } = useRouter();
    const { isTyping } = useFocusContext();
    const { activeConfigName } = useAppContext();
    const operations = usePipelineOperations();
    const { target, connection } = operations;
    const [slug, setSlug] = useState(params.pipelineSlug ?? '');
    const [limit, setLimit] = useState(20);
    const [lookup, setLookup] = useState(!params.pipelineSlug);
    const [selection, setSelection] = useState<{ target: typeof target; slug: string; key?: string }>({ target, slug });
    if (selection.target !== target || selection.slug !== slug) {

        setSelection({ target, slug, key: '' });

    }
    const { isFocused } = useFocusScope({ label: 'Pipeline history', skip: lookup });
    const [records, setRecords] = useState<NoormPipelineRun[]>([]);
    const [loadedTarget, setLoadedTarget] = useState(target);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [inspection, setInspection] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const query = `${slug}:${limit}:${refresh}`;
    const [settledQuery, setSettledQuery] = useState<string | null>(null);
    useAsyncEffect(async (cancelled) => {

        setSettledQuery(null);

        setRecords([]);
        setError(false);
        if (!target || !slug || lookup) {

            setLoading(false);

            return;

        }
        setLoading(true);
        const [found, historyError] = await attempt(() => operations.history(slug, limit));
        if (cancelled()) return;
        if (historyError) setError(true);
        else {

            setRecords([...found].sort((a, b) => b.id - a.id));

        }
        setLoadedTarget(target);
        setSettledQuery(query);
        setLoading(false);

    }, [target, slug, limit, lookup, refresh]);
    useInput((input, key) => {

        if (!isFocused || lookup || inspection || isTyping()) return;
        if (key.escape) back();
        if (input === 'h') setLookup(true);
        if (input === 'i') navigate('pipeline/history/detail');
        if (input === 'r') setRefresh((current) => current + 1);
        if (input === 'd') setInspection(true);

    });
    if (inspection) return <TextOverlay title="Pipeline history details" text={`Pipeline: ${slug}\nConfiguration: ${activeConfigName ?? 'none'}\nLimit: ${limit}`}
        onClose={() => setInspection(false)} />;
    if (lookup) return <Panel title="Pipeline history lookup" paddingX={1}>
        <Form key={`${slug}:${limit}`} fields={[
            { key: 'slug', label: 'Pipeline slug', type: 'text', defaultValue: slug, required: true,
                validate: (value) => isPipelineSlug(value) ? undefined : 'Enter a pipeline slug' },
            { key: 'limit', label: 'Limit (1–100)', type: 'text', defaultValue: String(limit),
                validate: (value) => parseHistoryLimit(value) !== null ? undefined : 'Use a whole number from 1 to 100' },
        ]} submitLabel="Look up" onCancel={() => slug ? setLookup(false) : back()} onSubmit={(values) => {

            setSlug(String(values['slug']));
            setLimit(Number(values['limit']));
            setLookup(false);

        }} />
    </Panel>;

    return <Panel paddingX={1}>
        <PipelineHeading>{`Pipeline history: ${slug}`}</PipelineHeading>
        <Box flexDirection="column">
            <Text dimColor wrap="truncate">Configuration: {oneLine(activeConfigName ?? 'none')} · Newest first · Limit {limit}</Text>
            {connection.loading || loading || (target && (loadedTarget !== target || settledQuery !== query)) ? <Spinner label="Loading pipeline history..." />
                : !target ? <Text color="yellow">Select a ready database configuration to read history.</Text>
                    : error ? <Text color="red">Unable to read pipeline history for this configuration.</Text>
                        : <SelectList items={(loadedTarget === target ? records : []).map((run) => ({ key: String(run.id), value: run,
                            label: `#${run.id} · ${run.status} · ${run.transaction_outcome}` }))}
                        defaultValue={selection.target === target && selection.slug === slug ? selection.key : ''}
                        focusLabel={`Pipeline history runs: ${activeConfigName ?? 'none'}:${slug}`}
                        onHighlight={(item) => setSelection((currentSelection) => currentSelection.target === target
                            && currentSelection.slug === slug && currentSelection.key === item.key
                            ? currentSelection : { target, slug, key: item.key })}
                        renderItem={(item, state) => <Box flexGrow={1} flexShrink={1}>
                            <Text wrap="truncate" color={state.isHighlighted && state.isFocused ? 'cyan' : undefined}>{item.label}</Text>
                        </Box>}
                        onSelect={(item) => navigate('pipeline/history/detail', { pipelineRunId: item.value.id })}
                        isFocused={isFocused} reserveRows={3} emptyLabel="No pipeline runs in this configuration" />}
            <Text dimColor>[Enter] Run · [d] Details · [h] Lookup · [i] ID · [r] Refresh · [Esc] Back</Text>
        </Box>
    </Panel>;

}
