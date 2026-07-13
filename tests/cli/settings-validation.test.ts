import { describe, it, expect } from 'bun:test';

import { validateStagePort } from '../../src/tui/utils/settings-validation.js';

describe('settings-validation: validateStagePort', () => {

    it('accepts an empty/undefined value as unset (optional field)', () => {

        expect(validateStagePort(undefined)).toBeUndefined();
        expect(validateStagePort('')).toBeUndefined();

    });

    it('rejects non-numeric input', () => {

        expect(validateStagePort('abc')).not.toBeUndefined();

    });

    it('rejects out-of-range ports at both boundaries', () => {

        expect(validateStagePort('0')).not.toBeUndefined();
        expect(validateStagePort('65536')).not.toBeUndefined();

    });

    it('accepts in-range ports at both boundaries', () => {

        expect(validateStagePort('1')).toBeUndefined();
        expect(validateStagePort('65535')).toBeUndefined();

    });

});
