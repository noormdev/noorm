import { describe, expect, it } from 'bun:test';
import { parsePipelineInputText, resolvePipelineInput } from '../../../src/core/pipeline/input.js';
import type { PipelineInputDeclaration } from '../../../src/core/pipeline/types.js';

const declarations: Record<string, PipelineInputDeclaration> = {
    text: { type: 'string', description: 'Text', required: true },
    amount: { type: 'number', description: 'Amount', required: true },
    count: { type: 'integer', description: 'Count', required: true },
    enabled: { type: 'boolean', description: 'Enabled', required: true },
    object: { type: 'object', description: 'Object', required: true },
    array: { type: 'array', description: 'Array', required: true },
    optional: { type: 'string', description: 'Optional', required: false },
    mode: { type: 'string', description: 'Mode', required: true, default: 'a', choices: ['a', 'b'] },
};

function valid() {

    return { text: '', amount: 0, count: 0, enabled: false, object: { nested: [null, true, { x: 'y' }] }, array: [1, { x: [false] }] };

}

describe('pipeline: textual inputs', () => {

    it('should preserve literal text and decode exact falsy and structured values', () => {

        expect(parsePipelineInputText('text', declarations['text']!, '  λ café  ')).toBe('  λ café  ');
        expect(parsePipelineInputText('text', declarations['text']!, '')).toBe('');
        expect(parsePipelineInputText('amount', declarations['amount']!, '0')).toBe(0);
        expect(parsePipelineInputText('enabled', declarations['enabled']!, false)).toBe(false);
        expect(parsePipelineInputText('object', declarations['object']!, '{"items":[false,0]}')).toEqual({ items: [false, 0] });
        expect(parsePipelineInputText('array', declarations['array']!, '[0,false]')).toEqual([0, false]);

    });

    it('should reject coercive numbers, wrong JSON types and private values safely', () => {

        for (const raw of ['', ' 1', '1 ', '+1', '01', '0x10', 'Infinity', '1e999', 'private-value']) {

            expect(() => parsePipelineInputText('amount', declarations['amount']!, raw))
                .toThrow('Invalid value for pipeline input: amount');

        }
        expect(() => parsePipelineInputText('count', declarations['count']!, '1.5')).toThrow();
        expect(() => parsePipelineInputText('object', declarations['object']!, '[]')).toThrow();
        expect(() => parsePipelineInputText('array', declarations['array']!, '{}')).toThrow();

    });

});

describe('pipeline: invocation inputs', () => {

    it('should preserve falsy values, JSON structure, defaults and absence', () => {

        const input = resolvePipelineInput(declarations, valid());
        expect(input).toEqual({ ...valid(), mode: 'a' });
        expect('optional' in input).toBe(false);
        expect(resolvePipelineInput(declarations, { ...valid(), mode: 'b' })['mode']).toBe('b');

    });

    it('should report all missing required values while defaults satisfy required', () => {

        try {

            resolvePipelineInput(declarations, {});
            throw new Error('expected missing input rejection');

        }
        catch (error) {

            expect(error).toBeInstanceOf(Error);
            const message = String(error);
            for (const key of ['text', 'amount', 'count', 'enabled', 'object', 'array']) expect(message).toContain(key);
            expect(message).not.toContain('optional');
            expect(message).not.toContain('mode');

        }

    });

    for (const [key, value] of [
        ['text', 1], ['amount', '1'], ['amount', Infinity], ['amount', NaN],
        ['count', 1.5], ['count', Number.MAX_SAFE_INTEGER + 1], ['count', Number.MIN_SAFE_INTEGER - 1],
        ['enabled', 'false'], ['object', []], ['object', null], ['array', {}], ['array', null],
        ['mode', 'c'], ['unknown', 1],
    ] as const) {

        it(`should reject invalid ${key}: ${String(value)}`, () => {

            expect(() => resolvePipelineInput(declarations, { ...valid(), [key]: value })).toThrow();

        });

    }

    it('should accept finite numbers and safe integer endpoints', () => {

        for (const count of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {

            expect(resolvePipelineInput(declarations, { ...valid(), count, amount: Number.MAX_VALUE })['count']).toBe(count);

        }

    });

    it('should reject nested non-JSON values and prototype-polluting keys', () => {

        const cyclic: Record<string, unknown> = {};
        cyclic['self'] = cyclic;
        class Instance {

            value = 1;

        }
        const invalid: unknown[] = [
            { x: [Infinity] }, { x: [NaN] }, { x: [undefined] }, { x: [() => 1] },
            { x: [new Instance()] }, { x: [new Date()] }, cyclic,
            JSON.parse('{"x":[{"__proto__":{"polluted":true}}]}'),
            JSON.parse('{"x":{"constructor":{"prototype":{}}}}'),
            JSON.parse('{"x":{"prototype":1}}'),
        ];
        for (const object of invalid) expect(() => resolvePipelineInput(declarations, { ...valid(), object })).toThrow();

    });

    it('should reject sparse arrays, accessors, symbol keys and extra array properties', () => {

        const sparse = new Array(1);
        const accessor = Object.defineProperty({}, 'x', { enumerable: true, get: () => 1 });
        const symbol = { [Symbol('hidden')]: 1 };
        const extra = Object.assign([1], { extra: 2 });
        for (const object of [sparse, accessor, symbol, extra]) {

            expect(() => resolvePipelineInput(declarations, { ...valid(), object: { nested: object } })).toThrow();

        }

    });

    it('should make a detached deeply immutable invocation snapshot, including defaults', () => {

        const supplied = valid();
        const declared: Record<string, PipelineInputDeclaration> = {
            ...declarations,
            extra: { type: 'object', description: 'Default object', required: false, default: { nested: [1] } },
        };
        const snapshot = resolvePipelineInput(declared, supplied);
        supplied['object']['nested'].push(false);
        supplied['array'].push(99);
        const defaultValue = declared['extra']?.default;
        if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {

            const nested = defaultValue['nested'];
            if (Array.isArray(nested)) nested.push(2);

        }
        expect(snapshot['object']).toEqual({ nested: [null, true, { x: 'y' }] });
        expect(snapshot['array']).toEqual([1, { x: [false] }]);
        expect(snapshot['extra']).toEqual({ nested: [1] });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot['object'])).toBe(true);
        expect(Object.isFrozen(snapshot['array'])).toBe(true);
        expect(Object.isFrozen(snapshot['extra'])).toBe(true);
        expect(Object.isFrozen(snapshot['extra'])).toBe(true);

    });

});
