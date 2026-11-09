import { describe, expect, it } from 'bun:test';

import { EXIT } from '../../../src/cli/_exit.js';
import { interruptHandler, pipelineFailure } from '../../../src/cli/pipeline/_common.js';
import { PipelineBusyError } from '../../../src/core/pipeline/admission.js';
import { invalidDefinition, PipelineCodedError } from '../../../src/core/pipeline/errors.js';
import { ProtectedConfigError } from '../../../src/sdk/guards.js';

describe('cli: pipelineFailure', () => {

    const cases = [
        [invalidDefinition('dependency-cycle', 'x'), EXIT.USAGE, 'Invalid pipeline definition (dependency-cycle)'],
        [new PipelineCodedError('PIPELINE_INVALID_INPUT', 'x'), EXIT.USAGE, 'Invalid pipeline input'],
        [new PipelineCodedError('PIPELINE_POLICY_BLOCKED', 'x'), EXIT.FAILURE, 'Pipeline execution is blocked by the active configuration policy'],
        [new PipelineCodedError('PIPELINE_CONFIRMATION_REQUIRED', 'x'), EXIT.FAILURE, 'Pipeline execution requires confirmation; pass --yes'],
        [new PipelineCodedError('PIPELINE_NOT_FOUND', 'x'), EXIT.USAGE, 'Pipeline not found'],
        [new ProtectedConfigError('test', 'pipelines.run'), EXIT.FAILURE, 'Pipeline execution is blocked by the config policy or requires confirmation; pass --yes'],
        [new PipelineBusyError(), EXIT.FAILURE, 'Pipeline execution was not admitted'],
        [new Error('failed to prepare pipeline step 1'), EXIT.FAILURE, 'Pipeline execution failed'],
        ['not an error', EXIT.FAILURE, 'Pipeline execution failed'],
    ] as const;

    for (const [error, exit, message] of cases) {

        const label = error instanceof PipelineCodedError ? error.code : error instanceof Error ? error.name : String(error);

        it(`should map ${label} to exit ${exit}`, () => {

            expect(pipelineFailure(error, false)).toEqual({ exit, message });

        });

    }

    it('should print only the blocked message for a protected config when --yes was given', () => {

        expect(pipelineFailure(new ProtectedConfigError('test', 'pipelines.run'), true)).toEqual({
            exit: EXIT.FAILURE, message: 'Pipeline execution is blocked by the config policy',
        });

    });

});

describe('cli: interruptHandler', () => {

    it('should abort without exiting on the first SIGINT', () => {

        const controller = new AbortController();
        const exits: number[] = [];
        interruptHandler(controller, (code) => exits.push(code))();
        expect(controller.signal.aborted).toBe(true);
        expect(exits).toEqual([]);

    });

    it('should exit 130 on the second SIGINT', () => {

        const controller = new AbortController();
        const exits: number[] = [];
        const interrupt = interruptHandler(controller, (code) => exits.push(code));
        interrupt();
        interrupt();
        expect(exits).toEqual([130]);

    });

});
