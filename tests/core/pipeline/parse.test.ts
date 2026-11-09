import { describe, expect, it } from 'bun:test';

import { isPipelineSlug, parseHistoryLimit, parseRunId } from '../../../src/core/pipeline/parse.js';

describe('pipeline: parse', () => {

    const runIds: [unknown, number | null][] = [
        ['1', 1],
        ['42', 42],
        [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
        [String(Number.MAX_SAFE_INTEGER + 1), null],
        ['0', null],
        ['01', null],
        ['-1', null],
        ['+1', null],
        ['1.5', null],
        ['1e3', null],
        [' 1', null],
        ['1 ', null],
        ['', null],
        [undefined, null],
        [7, null],
        [null, null],
    ];

    it.each(runIds)('should parse run ID %p as %p', (input, expected) => {

        expect(parseRunId(input)).toBe(expected);

    });

    const limits: [unknown, number | null][] = [
        ['1', 1],
        ['20', 20],
        ['99', 99],
        ['100', 100],
        ['101', null],
        ['1000', null],
        ['0', null],
        ['05', null],
        ['-5', null],
        ['2.5', null],
        ['10 ', null],
        ['', null],
        [undefined, null],
        [20, null],
    ];

    it.each(limits)('should parse history limit %p as %p', (input, expected) => {

        expect(parseHistoryLimit(input)).toBe(expected);

    });

    const slugs: [unknown, boolean][] = [
        ['refresh', true],
        ['my-pipeline_2', true],
        ['a.b', true],
        ['', false],
        ['.', false],
        ['..', false],
        ['a/b', false],
        ['a\\b', false],
        ['a\0b', false],
        ['a:b', false],
        ['C:x', false],
        ['C:\\x', false],
        ['/abs', false],
        [undefined, false],
        [3, false],
    ];

    it.each(slugs)('should classify slug %p as %p', (input, expected) => {

        expect(isPipelineSlug(input)).toBe(expected);

    });

});
