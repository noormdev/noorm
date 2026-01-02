/**
 * Logger Output Format Tests
 *
 * Tests for JSON and inline output modes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Writable } from 'node:stream';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Logger, resetLogger } from '../../../src/core/logger/logger.js';
import { DEFAULT_LOGGER_CONFIG } from '../../../src/core/logger/types.js';

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
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-15T10:30:00.123-05:00'));

    });

    afterEach(async () => {

        vi.useRealTimers();
        await resetLogger();
        await rm(testDir, { recursive: true, force: true });

    });

    describe('stream routing', () => {

        it('should write to console stream when provided', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
                console: stream,
                json: true,
            });

            await logger.start();
            logger.info('test message');
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            expect(output[0]).toContain('test message');

        });

        it('should write to file stream when provided', async () => {

            const { stream: fileStream, output: fileOutput } = createMockStream();

            const logger = new Logger({
                projectRoot,
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

        it('should write to both console and file when both provided', async () => {

            const { stream: consoleStream, output: consoleOutput } = createMockStream();
            const { stream: fileStream, output: fileOutput } = createMockStream();

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
                console: consoleStream,
                file: fileStream,
                json: true,
            });

            await logger.start();
            logger.info('dual output');
            await logger.stop();

            expect(consoleOutput.length).toBeGreaterThan(0);
            expect(fileOutput.length).toBeGreaterThan(0);
            expect(consoleOutput[0]).toContain('dual output');
            expect(fileOutput[0]).toContain('dual output');

        });

    });

    describe('JSON mode (json: true)', () => {

        it('should output NDJSON with time, type, level, message fields', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
                console: stream,
                json: true,
            });

            await logger.start();
            logger.info('test message', { key: 'value' });
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);

            const parsed = JSON.parse(output[0]);
            expect(parsed).toHaveProperty('time');
            expect(parsed).toHaveProperty('type', 'log');
            expect(parsed).toHaveProperty('level', 'info');
            expect(parsed).toHaveProperty('message', 'test message');

        });

        it('should use ISO 8601 with timezone offset for time field', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
                console: stream,
                json: true,
            });

            await logger.start();
            logger.info('time test');
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]);
            // Should have ISO 8601 format with timezone offset
            expect(parsed.time).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

        });

        it('should flatten nested objects with dot-notation keys', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'verbose' },
                console: stream,
                json: true,
            });

            await logger.start();
            logger.info('nested test', {
                error: { message: 'timeout', code: 500 },
                filepath: 'test.sql',
            });
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]);
            // Should have flattened keys
            expect(parsed['error.message']).toBe('timeout');
            expect(parsed['error.code']).toBe(500);
            expect(parsed.filepath).toBe('test.sql');

        });

        it('should stringify arrays in JSON mode', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'verbose' },
                console: stream,
                json: true,
            });

            await logger.start();
            logger.info('array test', {
                items: ['a', 'b', 'c'],
            });
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]);
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
                config: DEFAULT_LOGGER_CONFIG,
                console: stream,
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
                config: DEFAULT_LOGGER_CONFIG,
                console: stream,
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
                config: DEFAULT_LOGGER_CONFIG,
                console: stream,
                json: true,
            });

            await logger.start();
            logger.info('info message', { key: 'value' });
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]);
            expect(parsed).toHaveProperty('time');
            expect(parsed).toHaveProperty('level', 'info');
            expect(parsed).toHaveProperty('message', 'info message');

        });

        it('should respect JSON mode for error()', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
                console: stream,
                json: true,
            });

            await logger.start();
            logger.error('error message');
            await logger.stop();

            expect(output.length).toBeGreaterThan(0);
            const parsed = JSON.parse(output[0]);
            expect(parsed).toHaveProperty('level', 'error');

        });

        it('should use short date in inline mode for direct methods', async () => {

            const { stream, output } = createMockStream();

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
                console: stream,
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
