import type { ConnectionConfig, Dialect } from '../connection/types.js';
import type { RunContext } from '../runner/types.js';
import type { PipelineRunStatus, PipelineStepStatus, PipelineTransactionOutcome } from '../shared/tables.js';

/** Everything {@link runPipeline} needs: a run context plus the connection target and pipeline settings. */
export interface PipelineContext extends Omit<RunContext, 'dialect' | 'signal'> {
    dialect: Dialect;
    /** The same database targeted by the metadata connection. */
    connectionConfig: ConnectionConfig;
    /** Invalidates an unrecoverable in-memory SQLite connection and its owner. */
    disposeMemoryConnection?: () => Promise<void>;
    pipelinesPath: string;
    cliVersion: string;
    poolMax?: number;
    yes?: boolean;
    /** Stops future scheduling; does not cancel an in-flight statement. */
    signal?: AbortSignal;
}

/** Per-invocation options for a pipeline run. */
export interface PipelineRunOptions {
    input?: unknown;
    dryRun?: boolean;
    /** Overrides `context.signal` for this run. */
    signal?: AbortSignal;
}

/** A failure recorded on a run or step. The message is fixed text, never driver output, so it is safe to store and print. */
export interface PipelineError {
    phase: 'execute' | 'commit' | 'rollback' | 'audit' | 'cleanup' | 'interrupted';
    message: string;
    stepNo?: number;
    code?: string;
}

/** Identity of a step as stored in history: no rendered SQL, only its path and checksum. */
export interface PipelineStepMetadata {
    stepNo: number;
    name: string;
    filepath: string;
    checksum: string;
    needs: readonly number[];
}

/** What happened to one step; `skipped` steps never started. */
export interface PipelineStepResult extends PipelineStepMetadata {
    status: PipelineStepStatus;
    transactionOutcome: PipelineTransactionOutcome | 'not_started';
    startedAt: Date | null;
    finishedAt: Date | null;
    durationMs: number;
    error: PipelineError | null;
    skipReason?: string;
}

interface PipelineResultBase {
    slug: string;
    mode: PipelineMode;
    transaction: PipelineTransaction;
    concurrency: number;
    singleRun: boolean;
}

/** Result of `dryRun`: the plan after validation and rendering, with nothing executed or recorded. */
export interface PipelineDryRunResult extends PipelineResultBase {
    dryRun: true;
    runId: null;
    status: 'success';
    transactionOutcome: 'no_effects';
    steps: PipelineStepMetadata[];
}

/** Result of an executed run. `status` is how execution ended; `transactionOutcome` is what the database was left with. */
export interface PipelineRunResult extends PipelineResultBase {
    dryRun: false;
    runId: number;
    status: PipelineRunStatus;
    transactionOutcome: PipelineTransactionOutcome;
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
    steps: PipelineStepResult[];
    primaryError: PipelineError | null;
    secondaryErrors: PipelineError[];
}

/** Where transactions begin and end: one for the pipeline, one per step, or left to the SQL (`none`). */
export type PipelineTransaction = 'pipeline' | 'step' | 'none';
/** `linear` runs steps in order; `graph` runs them as their `needs` allow. */
export type PipelineMode = 'linear' | 'graph';
/** Types a manifest input may declare; `integer` is checked separately from `number`. */
export type PipelineInputType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
/** A JSON value that survives a round trip, with no class instances or cycles. */
export type PipelineJsonValue = null | boolean | number | string | PipelineJsonValue[]
    | { [key: string]: PipelineJsonValue };
/** Values an input `choices` list may hold. */
export type PipelineScalar = string | number | boolean;
/** Deeply read-only {@link PipelineJsonValue}. */
export type PipelineReadonlyJsonValue = null | boolean | number | string | readonly PipelineReadonlyJsonValue[]
    | { readonly [key: string]: PipelineReadonlyJsonValue };
/** Detached, frozen copy of the resolved inputs for one invocation. */
export type PipelineInputSnapshot = Readonly<Record<string, PipelineReadonlyJsonValue>>;

/** A step after rendering: its SQL is held only for execution. */
export interface PreparedPipelineStep {
    readonly stepNo: number;
    readonly id: string;
    /** Declared relative SQL path. */
    readonly sqlPath: string;
    /** Resolved source path. */
    readonly filepath: string;
    readonly needs: readonly number[];
    /** Rendered SQL, retained for execution, never for history or default output. */
    readonly sql: string;
    readonly checksum: string;
}

/** A validated, rendered pipeline ready to admit and run. */
export interface PreparedPipeline {
    readonly slug: string;
    readonly manifestChecksum: string;
    readonly transaction: PipelineTransaction;
    readonly concurrency: number;
    readonly singleRun: boolean;
    readonly mode: PipelineMode;
    readonly steps: readonly PreparedPipelineStep[];
}

/** One input declared in the manifest; `choices` are scalar-only and `default` must be one of them. */
export interface PipelineInputDeclaration {
    type: PipelineInputType;
    description: string;
    required: boolean;
    default?: PipelineJsonValue;
    choices?: PipelineScalar[];
}

/** One step as declared in the manifest, with its path resolved. */
export interface PipelineStepDefinition {
    stepNo: number;
    id: string;
    sql: string;
    filepath: string;
    needs: number[];
}

/** A pipeline manifest after validation; no SQL has been read or run. */
export interface PipelineDefinition {
    slug: string;
    folder: string;
    manifestPath: string;
    manifestChecksum: string;
    description?: string;
    transaction: PipelineTransaction;
    concurrency: number;
    singleRun: boolean;
    mode: PipelineMode;
    inputs: Record<string, PipelineInputDeclaration>;
    steps: PipelineStepDefinition[];
}

/** Where to find a pipeline: `<projectRoot>/<pipelinesPath>/<slug>/pipeline.yml`. */
export interface LoadPipelineDefinitionOptions {
    projectRoot: string;
    pipelinesPath: string;
    slug: string;
}
