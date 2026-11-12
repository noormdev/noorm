import { useEffect, useRef, useState } from 'react';
import { attempt, attemptSync } from '@logosdx/utils';
import type { ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ScreenProps } from '../../types.js';
import { useAppContext, useGlobalModes } from '../../app-context.js';
import { useRouter } from '../../router.js';
import { useBusy, useFocusScope } from '../../focus.js';
import { useAsyncEffect } from '../../hooks/index.js';
import { usePipelineOperations } from '../../hooks/usePipelineOperations.js';
import type { PipelineOperationTarget } from '../../hooks/usePipelineOperations.js';
import { Panel, SelectList, SmartConfirm, Spinner, TextOverlay } from '../../components/index.js';
import { loadPipelineDefinition } from '../../../core/pipeline/definition.js';
import { resolvePipelineInput } from '../../../core/pipeline/input.js';
import { getPipelineConcurrency } from '../../../core/pipeline/scheduler.js';
import { DEFAULT_PIPELINES_PATH } from '../../../core/settings/defaults.js';
import { checkConfigPolicy } from '../../../core/policy/index.js';
import { PipelineCodedError, PipelineDefinitionError } from '../../../core/pipeline/errors.js';
import type { PipelineDefinition, PipelineDryRunResult, PipelineJsonValue, PipelineRunResult } from '../../../core/pipeline/types.js';
import { oneLine } from '../../utils/string.js';
import { PipelineInputEditor } from './PipelineInputEditor.js';
import { inputPresence, PipelineEvidence, PipelineHeading } from './helpers.js';
import { Hotkey, HotkeyLine } from '../../components/layout/Hotkey.js';

type Confirmation = {
    target: PipelineOperationTarget;
    slug: string;
    dryRun: boolean;
    configName: string;
    input: Record<string, PipelineJsonValue>;
    requiresConfirmation: boolean;
    confirmationPhrase?: string;
};

/** A coded failure is a refusal before admission, so it names its rule or fixed reason instead of pointing at history that has no row. */
function codedFailureMessage(error: PipelineCodedError): string {

    return error instanceof PipelineDefinitionError ? `Invalid definition (${error.rule})` : error.message;

}

/**
 * Review, confirm and run one pipeline. The confirmation captures the target, mode and inputs,
 * so a config or dry-run switch after review cannot change what runs.
 *
 * @example
 * navigate('pipeline/run', { pipelineSlug: 'refresh' });
 */
export function PipelineRunScreen({ params }: ScreenProps): ReactElement {

    const { back, navigate } = useRouter();
    const { projectRoot, settings, activeConfig, activeConfigName } = useAppContext();
    const modes = useGlobalModes();
    const operations = usePipelineOperations();
    const { target } = operations;
    const path = settings?.paths?.pipelines ?? DEFAULT_PIPELINES_PATH;
    const slug = params.pipelineSlug;
    const reviewIdentity = `${activeConfigName}:${projectRoot}:${path}:${slug}`;
    const [definition, setDefinition] = useState<PipelineDefinition | null>(null);
    const [loading, setLoading] = useState(true);
    const [overrides, setOverrides] = useState<Record<string, PipelineJsonValue>>({});
    const [editing, setEditing] = useState<string | null>(null);
    const { isFocused } = useFocusScope({ label: 'Pipeline run', skip: editing !== null });
    const [selected, setSelected] = useState<string>();
    const [reviewStep, setReviewStep] = useState<string>();
    const [reviewScope, setReviewScope] = useState(() => ({ target, identity: reviewIdentity, generation: 0 }));
    if (reviewScope.target !== target || reviewScope.identity !== reviewIdentity) {

        setReviewScope({ target, identity: reviewIdentity, generation: reviewScope.generation + 1 });
        setReviewStep('');

    }
    const [resultStep, setResultStep] = useState<string>();
    const [tab, setTab] = useState<'inputs' | 'steps'>('inputs');
    const [description, setDescription] = useState<string | null>(null);
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [result, setResult] = useState<PipelineDryRunResult | PipelineRunResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [invocation, setInvocation] = useState<{ configName: string; dryRun: boolean } | null>(null);
    const submitting = useRef(false);
    const mounted = useRef(true);

    useBusy(busy);

    useEffect(() => {

        mounted.current = true;

        return () => {

            mounted.current = false;

        };

    }, []);
    useEffect(() => {

        if (!busy) return;
        const start = Date.now();
        const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

        return () => clearInterval(timer);

    }, [busy]);
    useEffect(() => {

        if (confirmation && confirmation.target !== target) {

            setConfirmation(null);
            setError('Target changed. Review and confirm again.');

        }

    }, [target, confirmation]);
    useAsyncEffect(async (cancelled) => {

        setLoading(true);
        setDefinition(null);
        setOverrides({});
        setEditing(null);
        setConfirmation(null);
        setResultStep(undefined);
        setResult(null);
        setInvocation(null);
        setDescription(null);
        setError(null);
        const [loaded, loadError] = await attempt(async () => {

            if (!slug) throw new Error('Missing slug');

            return loadPipelineDefinition({ projectRoot, pipelinesPath: path, slug });

        });
        if (cancelled()) return;
        if (loadError) setError(loadError instanceof PipelineCodedError
            ? `${codedFailureMessage(loadError)}. Cannot run.`
            : 'Invalid or unavailable pipeline definition. Cannot run.');
        else {

            setDefinition(loaded);
            setSelected(Object.keys(loaded.inputs)[0]);

        }
        setLoading(false);

    }, [projectRoot, path, slug]);

    const check = activeConfig ? checkConfigPolicy('user', activeConfig, 'pipeline:run') : null;
    const requestRun = () => {

        if (!definition || submitting.current || busy || operations.running) return;
        if (!check?.allowed) {

            setError('Pipeline execution is not allowed by the active configuration policy.');

            return;

        }
        if (!target) {

            setError('Select a ready database configuration before running.');

            return;

        }
        const [, inputError] = attemptSync(() => resolvePipelineInput(definition.inputs, overrides));
        if (inputError) {

            const missing = Object.entries(definition.inputs).filter(([name, declaration]) => declaration.required
                && !Object.hasOwn(overrides, name) && !Object.hasOwn(declaration, 'default')).map(([name]) => name);
            setError(missing.length ? `Missing required pipeline inputs: ${missing.join(', ')}` : 'Invalid pipeline inputs. Review saved overrides.');

            return;

        }
        setError(null);
        setConfirmation({ target, slug: definition.slug, dryRun: modes.dryRun, configName: activeConfigName ?? 'config', input: { ...overrides },
            requiresConfirmation: check.requiresConfirmation, confirmationPhrase: check.confirmationPhrase });

    };
    const execute = async () => {

        const captured = confirmation;
        if (!captured || !slug || submitting.current) return;
        setConfirmation(null);
        if (captured.target !== target || captured.slug !== slug) {

            setError('Target changed. Review and confirm again.');

            return;

        }
        submitting.current = true;
        setBusy(true);
        setStopping(false);
        setElapsed(0);
        setResult(null);
        setResultStep('');
        setInvocation({ configName: captured.configName, dryRun: captured.dryRun });
        const [completed, runError] = await attempt(() => operations.run(captured.slug, {
            input: captured.input, dryRun: captured.dryRun, yes: true, target: captured.target,
        }));
        if (mounted.current) {

            if (runError) setError(runError instanceof PipelineCodedError
                ? codedFailureMessage(runError)
                : 'Pipeline could not complete. Inspect scoped history for recorded execution evidence.');
            else setResult(completed);

        }
        submitting.current = false;
        if (mounted.current) setBusy(false);

    };
    useInput((input, key) => {

        if (!isFocused || editing || confirmation || description !== null) return;
        if (busy) {

            if (key.escape && !stopping) {

                operations.stop(); setStopping(true);

            }

            return;

        }
        if (key.escape) {

            back();

            return;

        }
        if (input === 'h') {

            navigate('pipeline/history', slug ? { pipelineSlug: slug } : {});

            return;

        }
        if (result) {

            if (input === 'r') {

                setResult(null); setError(null);

            }
            if (input === 'd') setDescription([
                `Pipeline: ${result.slug}`,
                `Configuration: ${invocation?.configName ?? 'none'}`,
                `Run ID: ${result.runId ?? 'none (dry run)'}`,
                `Execution status: ${result.status}`,
                `Transaction outcome: ${result.transactionOutcome}`,
                ...(!result.dryRun ? [result.primaryError, ...result.secondaryErrors].flatMap((failure) => failure
                    ? [`Error phase: ${failure.phase}${failure.stepNo === undefined ? '' : ` · Step ${failure.stepNo}`}`] : []) : []),
            ].join('\n'));

            return;

        }
        if (input === 'r') requestRun();
        if (input === 's') setTab((current) => current === 'steps' ? 'inputs' : 'steps');
        if (input === 'd') setDescription([
            `Pipeline: ${slug ?? 'review'}`,
            `Configuration: ${activeConfigName ?? 'none'}`,
            error ?? (selected && tab === 'inputs' ? definition?.inputs[selected]?.description : definition?.description) ?? 'No description.',
        ].join('\n'));
        if (input === 'x' && selected && tab === 'inputs') setOverrides((current) => {

            const next = { ...current };
            delete next[selected];

            return next;

        });

    });
    if (description !== null) return <TextOverlay title="Pipeline details" text={description} onClose={() => setDescription(null)} />;
    if (editing && definition?.inputs[editing]) return <Panel title={`Pipeline input: ${editing}`} paddingX={1}>
        <PipelineInputEditor key={editing} name={editing} declaration={definition.inputs[editing]!} overrides={overrides}
            onSave={(value) => {

                setOverrides((current) => ({ ...current, [editing]: value })); setEditing(null); setError(null);

            }}
            onCancel={() => setEditing(null)} />
    </Panel>;
    if (confirmation) return <SmartConfirm requiresConfirmation={confirmation.requiresConfirmation}
        confirmationPhrase={confirmation.confirmationPhrase} configName={confirmation.configName}
        action={confirmation.dryRun ? 'validate this pipeline without executing SQL' : 'run this pipeline'}
        message={`${confirmation.dryRun ? 'Dry run' : 'Run'} ${oneLine(slug ?? '')} on ${oneLine(confirmation.configName)}?`}
        onConfirm={() => {

            void execute();

        }} onCancel={() => setConfirmation(null)} isFocused={isFocused} />;

    return <Panel paddingX={1}>
        <PipelineHeading>{`Pipeline: ${slug ?? 'review'}`}</PipelineHeading>
        <Box flexDirection="column">
            {busy ? <Box flexDirection="column">
                <Spinner label={`${invocation?.dryRun ? 'Validating' : 'Running'} on ${oneLine(invocation?.configName ?? '')} · ${elapsed}s`} />
                {stopping ? <Text>Stop requested. Waiting for running SQL and transaction cleanup to finish.</Text> : <Hotkey keys="Esc" dim={false}>Request stop (running SQL must settle)</Hotkey>}
            </Box> : result ? <>
                <Text dimColor wrap="truncate">Target: {oneLine(invocation?.configName ?? '')} · {result.dryRun ? 'Dry run — no workflow SQL or run history written' : 'Execution result'}</Text>
                <PipelineEvidence runId={result.runId} status={result.status} outcome={result.transactionOutcome}
                    isFocused={isFocused} onInspect={setDescription} defaultValue={resultStep}
                    onHighlight={(step) => setResultStep(String(step.stepNo))}
                    cleanupFailed={operations.cleanupFailed}
                    steps={result.steps.map((step) => ({ stepNo: step.stepNo, name: step.name, needs: step.needs,
                        ...('status' in step ? { status: step.status, outcome: step.transactionOutcome, error: step.error } : {}) }))} />
                {!result.dryRun && result.primaryError && <Text color="yellow">Error phase: {result.primaryError.phase}{result.primaryError.stepNo === undefined ? '' : ` · Step ${result.primaryError.stepNo}`}</Text>}
                <HotkeyLine>[Enter] Step details · [d] Evidence · [r] Review · [h] History · [Esc] Back</HotkeyLine>
            </> : loading ? <Spinner label="Loading pipeline definition..." /> : definition ? <>
                <Text>Mode: {definition.mode} · Transaction: {definition.transaction} · Single run: {definition.singleRun ? 'protected' : 'off'}</Text>
                <Text>Concurrency: configured {definition.concurrency} · effective {activeConfig ? getPipelineConcurrency(definition, activeConfig.connection.dialect, activeConfig.connection.pool?.max) : 'select config'}</Text>
                <Text dimColor>Next invocation: {modes.dryRun ? 'dry run' : 'execute'} · Force has no pipeline effect.</Text>
                {tab === 'inputs' ? <SelectList key="inputs" defaultValue={selected} focusLabel={`Pipeline review inputs:${reviewIdentity}`}
                    items={Object.entries(definition.inputs).map(([name, declaration]) => ({ key: name, value: name,
                        label: `${name} · ${declaration.type} · ${inputPresence(name, declaration, overrides)}` }))}
                    onHighlight={(item) => setSelected(item.value)} onSelect={(item) => setEditing(item.value)}
                    renderItem={(item, state) => <Box flexGrow={1} flexShrink={1}>
                        <Text wrap="truncate" color={state.isHighlighted && state.isFocused ? 'cyan' : undefined}>{item.label}</Text>
                    </Box>}
                    isFocused={isFocused} reserveRows={8} emptyLabel="No declared inputs" />
                    : <SelectList key={`steps:${reviewScope.generation}`} defaultValue={reviewStep}
                        focusLabel={`Pipeline review steps:${reviewIdentity}`}
                        onHighlight={(item) => setReviewStep(item.key)}
                        items={definition.steps.map((step) => ({ key: String(step.stepNo), value: step,
                            label: `${step.stepNo}. ${oneLine(step.id)} · needs: ${step.needs.join(', ') || 'none'}` }))}
                        renderItem={(item, state) => <Box flexGrow={1} flexShrink={1}>
                            <Text wrap="truncate" color={state.isHighlighted && state.isFocused ? 'cyan' : undefined}>{item.label}</Text>
                        </Box>}
                        onSelect={(item) => setDescription(`Step ${item.value.stepNo}: ${item.value.id}\nDependencies: ${item.value.needs.join(', ') || 'none'}`)}
                        isFocused={isFocused} reserveRows={8} />}
                <Text dimColor wrap="truncate">{tab === 'inputs' && selected ? oneLine(definition.inputs[selected]?.description ?? '') : 'Steps in declaration order'}</Text>
                <HotkeyLine>{`[Enter] ${tab === 'inputs' ? 'Edit' : 'Step details'} · [x] Reset · [s] Inputs/steps · [d] Details`}</HotkeyLine>
                <HotkeyLine>{`[r] ${modes.dryRun ? 'Dry run' : 'Run'} · [h] History · [Esc] Back`}</HotkeyLine>
            </> : null}
            {!busy && error && <Text color="red" wrap="truncate">{oneLine(error)}</Text>}
            {!busy && operations.cleanupFailed && <Text color="yellow" wrap="truncate">Connection cleanup failed. Execution evidence is preserved; exit status is nonzero.</Text>}
            {!busy && !loading && !definition && <HotkeyLine>[d] Details · [h] History · [Esc] Back</HotkeyLine>}
            {!busy && !result && !target && <Text color="yellow">Database not ready. Browsing and input editing remain available.</Text>}
        </Box>
    </Panel>;

}
