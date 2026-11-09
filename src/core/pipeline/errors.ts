/** The definition rule that failed. Fixed identifiers, so they can never carry a value. */
export type PipelineDefinitionRule =
    | 'slug'
    | 'pipelines-path'
    | 'path-escape'
    | 'path-kind'
    | 'missing-directory'
    | 'missing-file'
    | 'unreadable-path'
    | 'yaml'
    | 'manifest-schema'
    | 'input-name'
    | 'input-default'
    | 'input-choices'
    | 'input-default-choice'
    | 'mixed-dependencies'
    | 'duplicate-step'
    | 'step-sql-path'
    | 'step-dependency'
    | 'dependency-cycle'
    | 'transaction-control'
    | 'escape-unavailable'
    | 'step-prepare';

/** A pipeline failure whose class is decided by `code`, not by its message text. */
export class PipelineCodedError extends Error {

    /** Internal classification the CLI maps to an exit code; never printed or exported from the SDK. */
    readonly code:
        | 'PIPELINE_BUSY'
        | 'PIPELINE_INVALID_DEFINITION'
        | 'PIPELINE_INVALID_INPUT'
        | 'PIPELINE_POLICY_BLOCKED'
        | 'PIPELINE_CONFIRMATION_REQUIRED'
        | 'PIPELINE_NOT_FOUND';

    constructor(code: PipelineCodedError['code'], message: string, options: ErrorOptions = {}) {

        super(message, options);
        this.name = 'PipelineCodedError';
        this.code = code;

    }

}

/** An invalid-definition failure; the rule is required so a message never reads "(undefined)". */
export class PipelineDefinitionError extends PipelineCodedError {

    readonly rule: PipelineDefinitionRule;

    constructor(rule: PipelineDefinitionRule, message: string, options: ErrorOptions = {}) {

        super('PIPELINE_INVALID_DEFINITION', message, options);
        this.name = 'PipelineDefinitionError';
        this.rule = rule;

    }

}

/** Builds the invalid-definition error for `rule`; attach only a cause that is safe to log. */
export function invalidDefinition(rule: PipelineDefinitionRule, message: string, cause?: unknown): PipelineDefinitionError {

    return new PipelineDefinitionError(rule, message, cause === undefined ? {} : { cause });

}

/** Builds the invalid-input error. */
export function invalidInput(message: string): PipelineCodedError {

    return new PipelineCodedError('PIPELINE_INVALID_INPUT', message);

}

/** Builds an unknown-pipeline error. */
export function pipelineNotFound(): PipelineCodedError {

    return new PipelineCodedError('PIPELINE_NOT_FOUND', 'Pipeline not found');

}

/** A cause that keeps only the failure's class name; the original text can carry input, secrets or paths. */
export function classOnlyCause(error: unknown): Error {

    const cause = new Error('Cause text withheld');
    cause.name = error instanceof Error && /^[A-Za-z]*Error$/.test(error.name) ? error.name : 'Error';

    return cause;

}
