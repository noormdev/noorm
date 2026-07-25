/**
 * Logger Output Format Tests
 *
 * Tests for JSON and inline output modes.
 */
import { describe, it, expect, beforeEach, afterEach, setSystemTime } from 'bun:test';
import { Writable } from 'node:stream';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Logger, resetLogger } from '../../../src/core/logger/logger.js';
import { DEFAULT_LOGGER_CONFIG } from '../../../src/core/logger/types.js';
import type { Settings } from '../../../src/core/settings/types.js';

const settings = {} as Settings;

/**
 * Create a mock writable stream that captures output.
 */
function createMockStream(): { stream: Writable; output: string[] } {

    const output: string[] = [];
    const stream = new Writable({
        write(chunk, _encoding, callback) {

            output.push(chunk.toString());
            callback();

        },
    });

    return { stream, output };

}

describe('logger: output formats', () => {

    let testDir: string;
    let projectRoot: string;

    beforeEach(async () => {

        testDir = join(
            tmpdir(),
            `noorm-test-logger-output-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        projectRoot = testDir;
        await mkdir(testDir, { recursive: true });
        await mkdir(join(testDir, '.noorm'), { recursive: true });

        // Use fake timers for consistent timestamps
        setSystemTime(new Date('2024-01-15T10:30:00.123-05:00'));

    });

    afterEach(async () => {

        setSystemTime();
        await resetLogger();
        await rm(testDir, { recursive: true, force: true });

    });

    describe('stream routing', () => {

        // CP4: the event stream (info/warn/error/debug, observer events) is
        // diagnostics output, not a command result — it must land on stderr
        // in every mode, including json, so it never mixes with the one
        // parseable JSON document `result()` puts on stdout.
        it('should write to diagnostics stream when provided, even in json mode', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                diagnostics: stream,
                json: true,
            });

            await logger.start();
            logger.info('test message');
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            expect(output[0]).toContain('test message');

        });

        it('should not write event-stream output to the console stream, even in json mode', async () => {

            const { stream: consoleStream, output: consoleOutput } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                console: consoleStream,
                json: true,
            });

            await logger.start();
            logger.info('test message');
            await logger.stop();

            expect(consoleOutput.length).toBe(0);

        });

        it('should write to file stream when provided', async () => {

            const { stream: fileStream, output: fileOutput } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                file: fileStream,
                json: true,
            });

            await logger.start();
            logger.info('file test');
            await logger.stop();

            expect(fileOutput.length).toBeGreaterThan(0);
            expect(fileOutput[0]).toContain('file test');

        });

        it('should route result() to console and info() to diagnostics separately, both also reaching file', async () => {

            const { stream: consoleStream, output: consoleOutput } = createMockStream();
            const { stream: diagnosticsStream, output: diagnosticsOutput } = createMockStream();
            const { stream: fileStream, output: fileOutput } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                console: consoleStream,
                diagnostics: diagnosticsStream,
                file: fileStream,
                json: true,
            });

            await logger.start();
            logger.info('dual output');
            logger.result({ ok: true });
            await logger.stop();

            expect(diagnosticsOutput.length).toBeGreaterThan(0);
            expect(diagnosticsOutput[0]).toContain('dual output');

            expect(consoleOutput).toEqual(['{"ok":true}\n']);

            expect(fileOutput.length).toBeGreaterThan(0);

        });

    });

    describe('JSON mode (json: true)', () => {

        it('should output NDJSON with time, type, level, message fields', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                diagnostics: stream,
                json: true,
            });

            await logger.start();
            logger.info('test message', { key: 'value' });
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);

            const parsed = JSON.parse(output[0]!);
            expect(parsed).toHaveProperty('time');
            expect(parsed).toHaveProperty('type', 'log');
            expect(parsed).toHaveProperty('level', 'info');
            expect(parsed).toHaveProperty('message', 'test message');

        });

        it('should use ISO 8601 with timezone offset for time field', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                diagnostics: stream,
                json: true,
            });

            await logger.start();
            logger.info('time test');
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]!);
            // Should have ISO 8601 format with timezone offset
            expect(parsed.time).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

        });

        it('should flatten nested objects with dot-notation keys', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'verbose' },
                diagnostics: stream,
                json: true,
            });

            await logger.start();
            logger.info('nested test', {
                error: { message: 'timeout', code: 500 },
                filepath: 'test.sql',
            });
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]!);
            // Should have flattened keys
            expect(parsed['error.message']).toBe('timeout');
            expect(parsed['error.code']).toBe(500);
            expect(parsed.filepath).toBe('test.sql');

        });

        it('should stringify arrays in JSON mode', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'verbose' },
                diagnostics: stream,
                json: true,
            });

            await logger.start();
            logger.info('array test', {
                items: ['a', 'b', 'c'],
            });
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]!);
            // Arrays should be stringified
            expect(typeof parsed.items).toBe('string');
            expect(parsed.items).toBe('["a","b","c"]');

        });

    });

    describe('inline mode (json: false)', () => {

        it('should use short date format in plain text mode', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                diagnostics: stream,
                json: false,
                color: false,
            });

            await logger.start();
            logger.info('short date test');
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            // Should have short format like [24-01-15 10:30:00]
            expect(output[0]).toMatch(/\[\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);

        });

        it('should use plain text format when color disabled', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                diagnostics: stream,
                json: false,
                color: false,
            });

            await logger.start();
            logger.warn('warning message');
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            // Plain format: [timestamp] [LEVEL] message
            expect(output[0]).toMatch(/\[\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
            expect(output[0]).toContain('WARN');
            expect(output[0]).toContain('warning message');
            // Should NOT contain ANSI escape codes
            // eslint-disable-next-line no-control-regex
            expect(output[0]).not.toMatch(/\x1b\[/);

        });

    });

    describe('direct logging methods', () => {

        it('should respect JSON mode for info()', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                diagnostics: stream,
                json: true,
            });

            await logger.start();
            logger.info('info message', { key: 'value' });
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]!);
            expect(parsed).toHaveProperty('time');
            expect(parsed).toHaveProperty('level', 'info');
            expect(parsed).toHaveProperty('message', 'info message');

        });

        it('should respect JSON mode for error()', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                diagnostics: stream,
                json: true,
            });

            await logger.start();
            logger.error('error message');
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]!);
            expect(parsed).toHaveProperty('level', 'error');

        });

        it('should use short date in inline mode for direct methods', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                settings,
                config: DEFAULT_LOGGER_CONFIG,
                diagnostics: stream,
                json: false,
                color: false,
            });

            await logger.start();
            logger.warn('warning message');
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            // Should have short format
            expect(output[0]).toMatch(/\[\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);

        });

    });

});
