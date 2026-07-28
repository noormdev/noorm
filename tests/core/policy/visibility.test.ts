/**
 * Access policy: isVisibleToChannel fail-closed null-handling.
 */
import { describe, it, expect } from 'bun:test';
import { isVisibleToChannel } from '../../../src/core/policy/index.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

describe('policy: isVisibleToChannel', () => {

    it('should deny the mcp channel when access is undefined', () => {

        expect(isVisibleToChannel(undefined, 'mcp')).toBe(false);

    });

    it('should allow the user channel when access is undefined', () => {

        expect(isVisibleToChannel(undefined, 'user')).toBe(true);

    });

    it('should deny the mcp channel when access.mcp is false', () => {

        const access: ConfigAccess = { user: 'admin', mcp: false };

        expect(isVisibleToChannel(access, 'mcp')).toBe(false);

    });

    it('should allow the mcp channel when access.mcp is a real role', () => {

        const access: ConfigAccess = { user: 'admin', mcp: 'viewer' };

        expect(isVisibleToChannel(access, 'mcp')).toBe(true);

    });

});
