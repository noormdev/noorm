/**
 * Access policy: isVisibleToChannel fail-closed null-handling.
 */
import { describe, it, expect } from 'bun:test';
import { isVisibleToChannel } from '../../../src/core/policy/index.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

describe('policy: isVisibleToChannel', () => {

    it('should deny the agent channel when access is undefined', () => {

        expect(isVisibleToChannel(undefined, 'agent')).toBe(false);

    });

    it('should allow the user channel when access is undefined', () => {

        expect(isVisibleToChannel(undefined, 'user')).toBe(true);

    });

    it('should deny the agent channel when access.agent is false', () => {

        const access: ConfigAccess = { user: 'admin', agent: false };

        expect(isVisibleToChannel(access, 'agent')).toBe(false);

    });

    it('should allow the agent channel when access.agent is a real role', () => {

        const access: ConfigAccess = { user: 'admin', agent: 'viewer' };

        expect(isVisibleToChannel(access, 'agent')).toBe(true);

    });

});
