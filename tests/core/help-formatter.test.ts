/**
 * Help Formatter Tests
 */
import { describe, it, expect } from 'vitest';

import { formatHelp, stripColors } from '../../src/core/help-formatter.js';

describe('help-formatter: formatHelp', () => {

    describe('markdown headings', () => {

        it('should format # heading (h1) with primary color', () => {

            const result = formatHelp('# CONFIG');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('CONFIG');

        });

        it('should format ## heading (h2) with text color', () => {

            const result = formatHelp('## Usage');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('Usage');

        });

        it('should format ### heading (h3) with muted color', () => {

            const result = formatHelp('### SQL Example');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('SQL Example');

        });

    });

    describe('inline code', () => {

        it('should format inline code', () => {

            const result = formatHelp('Use `noorm config` to manage');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('Use noorm config to manage');

        });

        it('should format multiple inline codes', () => {

            const result = formatHelp('Use `--config` or `NOORM_CONFIG`');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('Use --config or NOORM_CONFIG');

        });

    });

    describe('code blocks', () => {

        it('should format code blocks', () => {

            const input = '```sql\nSELECT * FROM users;\n```';
            const result = formatHelp(input);

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('```sql\nSELECT * FROM users;\n```');

        });

        it('should handle code blocks without language', () => {

            const input = '```\nsome code\n```';
            const result = formatHelp(input);

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('```\nsome code\n```');

        });

    });

    describe('inline formatting', () => {

        it('should format **bold** text', () => {

            const result = formatHelp('This is **important** text');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('This is important text');

        });

        it('should format *italic* text', () => {

            const result = formatHelp('This is *optional* text');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('This is optional text');

        });

    });

    describe('command examples', () => {

        it('should highlight noorm commands in indented lines', () => {

            const result = formatHelp('    noorm -H config use dev');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('    noorm -H config use dev');

        });

        it('should highlight flags in commands', () => {

            const result = formatHelp('    noorm --json -H change ff');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('    noorm --json -H change ff');

        });

        it('should highlight $ commands', () => {

            const result = formatHelp('    $ noorm config');

            expect(result).toContain('\x1b[');
            expect(stripColors(result)).toBe('    $ noorm config');

        });

    });

    describe('full markdown help text', () => {

        it('should format complete markdown help', () => {

            const input = `
# CONFIG

Manage database configurations

## Usage

    noorm config [subcommand] [options]

## Description

Configurations store database connection details.
Use \`--config\` flag to specify a config.

## Examples

    noorm config use dev
    noorm -H --json config
`;

            const result = formatHelp(input);

            // Should contain ANSI codes
            expect(result).toContain('\x1b[');

            // Text should be preserved (minus markdown syntax)
            const stripped = stripColors(result);
            expect(stripped).toContain('CONFIG');
            expect(stripped).toContain('Usage');
            expect(stripped).toContain('noorm config [subcommand] [options]');
            expect(stripped).toContain('--config');
            expect(stripped).toContain('noorm config use dev');

        });

    });

});

describe('help-formatter: stripColors', () => {

    it('should remove ANSI escape codes', () => {

        const colored = '\x1b[1m\x1b[38;2;59;130;246mHello\x1b[39m\x1b[22m';
        const result = stripColors(colored);

        expect(result).toBe('Hello');

    });

    it('should handle text without colors', () => {

        const plain = 'Hello World';
        const result = stripColors(plain);

        expect(result).toBe('Hello World');

    });

});
