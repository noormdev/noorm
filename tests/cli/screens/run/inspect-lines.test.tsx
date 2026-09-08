/**
 * Inspect context line-builder tests.
 *
 * The inspect screen rendered a nested tree that grew with the context, so on
 * any real project the bottom of it — secrets, global secrets, environment —
 * sat below the fold with no key that could reach it. Ink has no scroll offset,
 * so the fix is structural: the view is built as a flat list of one element per
 * visual line, which is the only shape a viewport can slice. These tests pin
 * that shape and what the lines are allowed to say.
 *
 * The secret cases are the load-bearing ones. `$.secrets` used to show a key
 * count, which cannot answer the question the screen is opened to answer, and
 * the fix is a partial reveal — so what is pinned is that the plaintext is
 * absent and the masked form is present. Asserting only the latter would pass
 * on a line that printed both.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Box } from 'ink';
import React from 'react';

import type { CategorizedContext } from '../../../../src/tui/screens/run/RunInspectScreen.js';

import { contextLines, expandedLines } from '../../../../src/tui/screens/run/RunInspectScreen.js';

/** Row budget inside the inspect Panel on a 100-column terminal. */
const WIDE = 96;

// eslint-disable-next-line no-control-regex -- matching the ANSI SGR escape is the point
const ANSI_PATTERN = /\[[0-9;]*m/g;

function draw(lines: React.ReactElement[]): string {

    const { lastFrame, unmount } = render(<Box flexDirection="column">{lines}</Box>);
    const frame = (lastFrame() ?? '').replace(ANSI_PATTERN, '');

    unmount();

    return frame;

}

function makeContext(overrides: Partial<CategorizedContext> = {}): CategorizedContext {

    return {
        dataFiles: [{ key: 'users', value: [{ id: 1, name: 'ada' }] }],
        helpers: [],
        helperErrors: [],
        builtins: [{ key: 'quote', value: () => '' }],
        config: { host: 'localhost' },
        secrets: {},
        globalSecrets: {},
        env: {},
        ...overrides,
    };

}

describe('cli: inspect context lines', () => {

    it('should reveal part of a secret rather than only a key count', () => {

        const lines = contextLines(
            makeContext({ secrets: { DB_PASSWORD: 'sup3rs3cr3tvalue' } }),
            '/project',
            WIDE,
        );
        const frame = draw(lines);

        expect(frame).toContain('DB_PASSWORD');
        expect(frame).toContain('su*****alue');
        expect(frame).not.toContain('sup3rs3cr3tvalue');

    });

    it('should report the length as a number rather than as mask width', () => {

        const frame = draw(contextLines(
            makeContext({ secrets: { TOKEN: 'sup3rs3cr3tvalue' } }),
            '/project',
            WIDE,
        ));

        expect(frame).toContain('(16 chars)');

    });

    it('should tell a secret that is set but empty from one that is short', () => {

        const frame = draw(contextLines(
            makeContext({ secrets: { BLANK: '', TINY: 'abc' } }),
            '/project',
            WIDE,
        ));

        expect(frame).toContain('(empty)');
        expect(frame).toContain('(0 chars)');
        expect(frame).not.toContain('abc');

    });

    it('should mask global secrets on the same terms as config-scoped ones', () => {

        const frame = draw(contextLines(
            makeContext({ globalSecrets: { LICENSE: 'aaaabbbbccccdddd' } }),
            '/project',
            WIDE,
        ));

        expect(frame).toContain('aaaa'.slice(0, 2) + '*****' + 'dddd');
        expect(frame).not.toContain('aaaabbbbccccdddd');

    });

    it('should mask environment values, which carry secrets nothing here can identify', () => {

        const frame = draw(contextLines(
            makeContext({ env: { AWS_SECRET_ACCESS_KEY: 'abcdefghijklmnopqrst' } }),
            '/project',
            WIDE,
        ));

        expect(frame).toContain('AWS_SECRET_ACCESS_KEY');
        expect(frame).toContain('ab*****qrst');
        expect(frame).not.toContain('abcdefghijklmnopqrst');

    });

    it('should keep a multi-line secret to one row', () => {

        // `wrap="truncate"` bounds width, not height: Ink still breaks on an
        // embedded newline, so one of these rows would draw three and put the
        // viewport's count out by two for everything below it.
        //
        // The newline has to fall inside the revealed window to reach the
        // screen at all. A whole PEM key does not test this: the mask keeps
        // two leading and four trailing characters, which for
        // `-----BEGIN…-----` are dashes, so the newlines never survive masking
        // and the case passes whether or not the guard is there.
        const lines = contextLines(
            makeContext({ secrets: { TLS_KEY: '\nMIIEvQIBADANBgkq\n' } }),
            '/project',
            WIDE,
        );

        expect(draw(lines).split('\n')).toHaveLength(lines.length);

    });

    it('should keep a multi-line environment value and helper error to one row', () => {

        const lines = contextLines(
            makeContext({
                env: { SSH_KEY: 'line one\nline two\nline three' },
                helperErrors: [{
                    filepath: '/project/sql/helpers/slug.js',
                    error: new Error('Unexpected token\n  at line 3\n  at line 4'),
                }],
            }),
            '/project',
            WIDE,
        );

        expect(draw(lines).split('\n')).toHaveLength(lines.length);

    });

    it('should keep a data-file string preview with a newline to one row', () => {

        // `describeType` truncates a string preview by character count and was
        // safe under the old nested tree, which counted no rows.
        const lines = contextLines(
            makeContext({ dataFiles: [{ key: 'banner', value: 'first line\nsecond line' }] }),
            '/project',
            WIDE,
        );

        expect(draw(lines).split('\n')).toHaveLength(lines.length);

    });

    it('should draw one row per line, so a viewport can count them', () => {

        const lines = contextLines(
            makeContext({
                secrets: Object.fromEntries(
                    Array.from({ length: 12 }, (_, index) => [`SECRET_${index}`, 'x'.repeat(20)]),
                ),
            }),
            '/project',
            WIDE,
        );

        expect(draw(lines).split('\n')).toHaveLength(lines.length);

    });

    it('should omit a section that has nothing in it', () => {

        const frame = draw(contextLines(makeContext({ dataFiles: [] }), '/project', WIDE));

        expect(frame).not.toContain('Data Files');
        expect(frame).toContain('Built-ins');

    });

    it('should name the helper that failed to load, and why', () => {

        const frame = draw(contextLines(
            makeContext({
                helperErrors: [{
                    filepath: '/project/sql/helpers/slug.js',
                    error: new Error('Unexpected token'),
                }],
            }),
            '/project',
            WIDE,
        ));

        expect(frame).toContain('sql/helpers/slug.js');
        expect(frame).toContain('Unexpected token');

    });

    it('should wrap the expanded view so a narrow terminal still gets one row per line', () => {

        // A long key, not a long value: the expanded view reports shapes and
        // never prints a value, so the key is what can overflow a row.
        const value = { ['deeply_nested_'.repeat(30)]: 1 };
        const wide = expandedLines(makeContext({ dataFiles: [{ key: 'doc', value }] }), WIDE);
        const narrow = expandedLines(makeContext({ dataFiles: [{ key: 'doc', value }] }), 20);

        expect(narrow.length).toBeGreaterThan(wide.length);
        expect(draw(narrow).split('\n')).toHaveLength(narrow.length);

    });

});
