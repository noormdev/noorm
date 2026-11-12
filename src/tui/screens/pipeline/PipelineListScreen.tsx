import { useState } from 'react';
import type { ReactElement } from 'react';
import { attempt } from '@logosdx/utils';
import { Box, Text, useInput } from 'ink';
import type { ScreenProps } from '../../types.js';
import { useRouter } from '../../router.js';
import { useFocusContext, useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { useAsyncEffect } from '../../hooks/index.js';
import { Panel, SearchableList, Spinner } from '../../components/index.js';
import { DEFAULT_PIPELINES_PATH } from '../../../core/settings/defaults.js';
import { oneLine } from '../../utils/string.js';
import { discoverPipelineDefinitions } from './helpers.js';
import type { PipelineEntry } from './helpers.js';
import { HotkeyLine } from '../../components/layout/Hotkey.js';

/**
 * Entry point for pipelines in the TUI. Lists invalid definitions with their failed rule but refuses to open them,
 * so the operator sees why a pipeline cannot run without a run screen that has nothing to run.
 *
 * @example
 * navigate('pipeline');
 */
export function PipelineListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('Pipelines');
    const { projectRoot, settings } = useAppContext();
    const { isTyping } = useFocusContext();
    const path = settings?.paths?.pipelines ?? DEFAULT_PIPELINES_PATH;
    const [entries, setEntries] = useState<PipelineEntry[]>([]);
    const [selected, setSelected] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    useAsyncEffect(async (cancelled) => {

        setLoading(true);
        setEntries([]);
        setSelected(undefined);
        setError(false);
        const [found, discoverError] = await attempt(() => discoverPipelineDefinitions(projectRoot, path));
        if (cancelled()) return;
        if (discoverError) setError(true);
        else {

            setEntries(found);
            setSelected(found[0]?.slug);

        }
        setLoading(false);

    }, [projectRoot, path]);
    useInput((input, key) => {

        if (!isFocused || isTyping()) return;
        if (key.escape && (loading || error)) {

            back();

            return;

        }
        if (input === 'h') navigate('pipeline/history', selected ? { pipelineSlug: selected } : {});
        if (input === 'i') navigate('pipeline/history/detail');

    });

    return <Panel title="Pipelines" paddingX={1}>
        <Box flexDirection="column">
            {loading ? <Spinner label="Discovering pipelines..." /> : error ? <Text color="red">Unable to discover pipelines. Check the configured project path.</Text> : <SearchableList
                items={entries.map((entry) => ({ key: entry.slug, value: entry, label: oneLine(entry.slug),
                    description: entry.definition ? `${entry.definition.steps.length} steps · ${entry.definition.mode}` : `Invalid definition${entry.rule ? ` (${entry.rule})` : ''} — cannot run` }))}
                onSelect={(item) => {

                    if (item.value.definition) navigate('pipeline/run', { pipelineSlug: item.value.slug });

                }}
                onHighlight={(item) => setSelected(item.value.slug)}
                renderItem={(item, state) => <Box flexGrow={1} flexShrink={1}>
                    <Text wrap="truncate" color={state.isHighlighted && state.isFocused ? 'cyan' : undefined}>
                        {item.label} · {item.description}
                    </Text>
                </Box>}
                onCancel={back} isFocused={isFocused} emptyLabel="No pipelines found" reserveRows={2} />}
            <HotkeyLine>[Enter] Review · [h] History / slug lookup · [i] Run ID lookup · [Esc] Back</HotkeyLine>
        </Box>
    </Panel>;

}
