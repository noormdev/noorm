import { describe, it, expect } from 'bun:test';

import {
    buildAccessFromValues,
    validateConfigName,
    validatePort,
} from '../../src/tui/utils/config-validation.js';

describe('config-validation: buildAccessFromValues', () => {

    it('maps valid userRole/mcpRole values to the matching ConfigAccess', () => {

        expect(buildAccessFromValues({ userRole: 'operator', mcpRole: 'off' }))
            .toEqual({ user: 'operator', mcp: false });

        expect(buildAccessFromValues({ userRole: 'admin', mcpRole: 'admin' }))
            .toEqual({ user: 'admin', mcp: 'admin' });

        expect(buildAccessFromValues({ userRole: 'viewer', mcpRole: 'viewer' }))
            .toEqual({ user: 'viewer', mcp: 'viewer' });

    });

    it('fails closed to viewer/false when fields are missing', () => {

        expect(buildAccessFromValues({})).toEqual({ user: 'viewer', mcp: false });

    });

    it('fails closed to viewer/false on unrecognized/garbage values', () => {

        expect(buildAccessFromValues({ userRole: 'superuser', mcpRole: 'root' }))
            .toEqual({ user: 'viewer', mcp: false });

    });

});

describe('config-validation: validateConfigName', () => {

    it('rejects an empty name with a required-style message', () => {

        const error = validateConfigName('');

        expect(error).not.toBeUndefined();
        expect(error?.toLowerCase()).toContain('required');

    });

    it('rejects names with invalid characters', () => {

        expect(validateConfigName('a b')).not.toBeUndefined();
        expect(validateConfigName('a!b')).not.toBeUndefined();

    });

    it('accepts names matching the allowed character set', () => {

        expect(validateConfigName('dev')).toBeUndefined();
        expect(validateConfigName('my-config_1')).toBeUndefined();

    });

    it('rejects a name already present in existingNames with the duplicate message', () => {

        expect(validateConfigName('dev', ['dev', 'prod'])).toBe('Config name already exists');

    });

});

describe('config-validation: validatePort', () => {

    it('accepts an empty/undefined value as unset (optional field)', () => {

        expect(validatePort(undefined)).toBeUndefined();
        expect(validatePort('')).toBeUndefined();

    });

    it('rejects non-numeric input', () => {

        expect(validatePort('abc')).not.toBeUndefined();

    });

    it('rejects out-of-range ports at both boundaries', () => {

        expect(validatePort('0')).not.toBeUndefined();
        expect(validatePort('65536')).not.toBeUndefined();

    });

    it('accepts in-range ports at both boundaries', () => {

        expect(validatePort('1')).toBeUndefined();
        expect(validatePort('65535')).toBeUndefined();

    });

});
