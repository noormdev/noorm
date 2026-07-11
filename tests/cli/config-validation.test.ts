import { describe, it, expect } from 'bun:test';

import { buildAccessFromValues } from '../../src/tui/utils/config-validation.js';

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
