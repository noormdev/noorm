import { attemptSync } from '@logosdx/utils';

import { invalidInput } from './errors.js';
import type {
    PipelineInputDeclaration, PipelineInputType, PipelineJsonValue, PipelineReadonlyJsonValue, PipelineInputSnapshot, PipelineScalar,
} from './types.js';

const unsafeKeys = { ['__proto__']: true, prototype: true, constructor: true } as const;

/** Check JSON compatibility without accepting class instances, cycles or unsafe keys. */
export function isPipelineJsonValue(value: unknown, ancestors = new Set<object>()): value is PipelineJsonValue {

    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || ancestors.has(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null) return false;
    ancestors.add(value);
    let valid = true;
    for (const key of Reflect.ownKeys(value)) {

        if (Array.isArray(value) && key === 'length') continue;
        if (typeof key !== 'string' || Object.hasOwn(unsafeKeys, key)) {

            valid = false; break;

        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
            || !isPipelineJsonValue(descriptor.value, ancestors)) {

            valid = false; break;

        }
        if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {

            valid = false; break;

        }

    }
    if (Array.isArray(value) && Object.keys(value).length !== value.length) valid = false;
    ancestors.delete(value);

    return valid;

}

/** Narrows a manifest choice to the scalar types a declaration may list. */
export function isPipelineScalar(value: unknown): value is PipelineScalar {

    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

}

/** Shared value predicate for manifest declarations, invocations and CLI prompts. */
export function matchesPipelineInputType(value: unknown, type: PipelineInputType): value is PipelineJsonValue {

    if (!isPipelineJsonValue(value)) return false;
    switch (type) {

    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);

    }

}

/** Validate a single supplied value, including declared choices. Never includes the value in errors. */
export function validatePipelineInputValue(
    name: string,
    declaration: PipelineInputDeclaration,
    value: unknown,
): asserts value is PipelineJsonValue {

    if (!matchesPipelineInputType(value, declaration.type)) throw invalidInput(`Invalid value for pipeline input: ${name}`);
    if (declaration.choices && !declaration.choices.some((choice) => choice === value)) {

        throw invalidInput(`Value is not a choice for pipeline input: ${name}`);

    }

}

/** Decode terminal/CLI text without changing the typed invocation contract. */
export function parsePipelineInputText(name: string, declaration: PipelineInputDeclaration, raw: unknown): PipelineJsonValue {

    let value: unknown = raw;
    if (declaration.type !== 'string') {

        if (declaration.type === 'boolean' && typeof raw === 'boolean') value = raw;
        else if (typeof raw !== 'string') throw invalidInput(`Invalid value for pipeline input: ${name}`);
        else if ((declaration.type === 'number' || declaration.type === 'integer')
            && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {

            throw invalidInput(`Invalid value for pipeline input: ${name}`);

        }
        else {

            const [parsed, parseError] = attemptSync(() => JSON.parse(raw));

            if (parseError) throw invalidInput(`Invalid value for pipeline input: ${name}`);
            value = parsed;

        }

    }
    validatePipelineInputValue(name, declaration, value);

    return value;

}

/** Copy a JSON value, optionally guarding every structured member as it is frozen. */
function snapshot(value: PipelineInputSnapshot, guarded: true): PipelineInputSnapshot;
function snapshot(value: PipelineReadonlyJsonValue, guarded?: boolean): PipelineJsonValue;
function snapshot(value: PipelineReadonlyJsonValue, guarded = false): PipelineReadonlyJsonValue {

    if (value === null || typeof value !== 'object') return value;

    const copy: PipelineJsonValue[] | Record<string, PipelineJsonValue> = Array.isArray(value) ? [] : {};
    for (const [key, item] of Object.entries(value)) {

        Object.defineProperty(copy, key, {
            value: snapshot(item, guarded), enumerable: true, configurable: true, writable: true,
        });

    }
    Object.freeze(copy);
    if (!guarded) return copy;

    // The parent stores this proxy before freezing, satisfying Proxy invariants
    // for non-configurable, non-writable properties containing nested values.

    return new Proxy(copy, {
        get(target, prop, receiver) {

            // JSON.stringify probes toJSON; array methods and iteration use
            // inherited properties and symbols. Membership checks remain intact.
            if (typeof prop === 'symbol' || prop === 'toJSON' || prop in target) {

                return Reflect.get(target, prop, receiver);

            }
            throw new Error(`Pipeline input property not found: ${prop}`);

        },
    });

}

/** Make one guarded rendering view of an already validated invocation snapshot. */
export function guardPipelineInput(input: PipelineInputSnapshot): PipelineInputSnapshot {

    return snapshot(input, true);

}

/** Resolve defaults and return a detached, deeply frozen invocation snapshot. */
export function resolvePipelineInput(
    declarations: Record<string, PipelineInputDeclaration>,
    input: unknown = {},
): PipelineInputSnapshot {

    if (!isPipelineJsonValue(input) || input === null || typeof input !== 'object' || Array.isArray(input)) {

        throw invalidInput('Pipeline input must be a plain JSON object');

    }
    for (const name of Object.keys(input)) {

        if (!Object.hasOwn(declarations, name)) throw invalidInput('Undeclared pipeline input');

    }
    const missing: string[] = [];
    const result: Record<string, PipelineJsonValue> = {};
    for (const [name, declaration] of Object.entries(declarations)) {

        const supplied = Object.hasOwn(input, name);
        const hasDefault = Object.hasOwn(declaration, 'default');
        if (!supplied && !hasDefault) {

            if (declaration.required) missing.push(name);
            continue;

        }
        const value = supplied ? input[name] : declaration.default;
        validatePipelineInputValue(name, declaration, value);
        result[name] = snapshot(value);

    }
    if (missing.length) throw invalidInput(`Missing required pipeline inputs: ${missing.join(', ')}`);

    return Object.freeze(result);

}
