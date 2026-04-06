import { describe, it, expect, beforeEach } from 'bun:test';
import { SessionManager } from '../../../src/rpc/session.js';

describe('rpc: session manager', () => {

    let session: SessionManager;

    beforeEach(() => {

        session = new SessionManager();

    });

    describe('getContext', () => {

        it('should throw when not connected', () => {

            expect(() => session.getContext('dev')).toThrow(/not connected/i);

        });

        it('should throw with config name in error', () => {

            expect(() => session.getContext('production')).toThrow(/production/);

        });

    });

    describe('hasConnection', () => {

        it('should return false when not connected', () => {

            expect(session.hasConnection('dev')).toBe(false);

        });

    });

    describe('listConnections', () => {

        it('should return empty array when no connections', () => {

            expect(session.listConnections()).toEqual([]);

        });

    });

});
