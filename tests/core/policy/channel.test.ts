/**
 * Channel resolution from provenance.
 *
 * `Channel` names who is driving, not which binary was invoked. The CLI used
 * to assume those were the same thing and hardcoded `user`, so an agent
 * denied a write over MCP could shell out to `noorm` and get the human's
 * role. These tests fix the precedence that closes that, including the
 * `NOORM_CHANNEL` escape hatch a human needs when scripting from inside an
 * agent session.
 *
 * `resolveChannel` is pure over its env argument, so nothing here mutates
 * `process.env` — Bun caches some environment reads for the life of the
 * process and a mutation would leak into every file that runs after this one.
 */
import { describe, it, expect } from 'bun:test';

import { AGENT_HARNESSES, resolveChannel } from '../../../src/core/policy/index.js';

describe('policy: resolveChannel', () => {

    it('should resolve user for an empty environment', () => {

        expect(resolveChannel({})).toBe('user');

    });

    describe('harness provenance', () => {

        for (const harness of AGENT_HARNESSES) {

            for (const marker of harness.markers) {

                it(`should resolve agent when ${marker} is set (${harness.name})`, () => {

                    expect(resolveChannel({ [marker]: '1' })).toBe('agent');

                });

            }

        }

        it('should treat an exported-but-empty marker as absent', () => {

            // `CLAUDECODE=` is how a caller disables the marker; reading it as
            // present would make opting out impossible.
            expect(resolveChannel({ CLAUDECODE: '' })).toBe('user');

        });

        it('should not resolve agent from a terminal or a CI pipeline', () => {

            // TERM_PROGRAM is set by iTerm, VS Code and Warp alike, and CI
            // describes the pipeline, not the caller. Keying on either would
            // lock a human out of their own CLI.
            expect(resolveChannel({ TERM_PROGRAM: 'vscode' })).toBe('user');
            expect(resolveChannel({ CI: 'true', GITHUB_ACTIONS: 'true' })).toBe('user');

        });

    });

    describe('NOORM_CHANNEL override', () => {

        it('should let a human scripting inside an agent session opt out', () => {

            expect(resolveChannel({ CLAUDECODE: '1', NOORM_CHANNEL: 'user' })).toBe('user');

        });

        it('should let a caller declare the agent channel with no harness present', () => {

            expect(resolveChannel({ NOORM_CHANNEL: 'agent' })).toBe('agent');

        });

        it('should ignore an unrecognised value rather than failing or guessing', () => {

            // A typo must not silently grant the looser channel, and it must
            // not break the CLI either — fall through to provenance.
            expect(resolveChannel({ NOORM_CHANNEL: 'mcp' })).toBe('user');
            expect(resolveChannel({ NOORM_CHANNEL: 'mcp', CLAUDECODE: '1' })).toBe('agent');
            expect(resolveChannel({ NOORM_CHANNEL: '' })).toBe('user');

        });

        it('should outrank harness detection in both directions', () => {

            expect(resolveChannel({ CURSOR_AGENT: '1', NOORM_CHANNEL: 'user' })).toBe('user');
            expect(resolveChannel({ TERM_PROGRAM: 'iTerm.app', NOORM_CHANNEL: 'agent' })).toBe('agent');

        });

    });

    it('should read the real process environment when called with no argument', () => {

        // The suite pins NOORM_CHANNEL=user in tests/preload.ts precisely so
        // this is deterministic regardless of who ran `bun test`.
        expect(resolveChannel()).toBe('user');

    });

});
