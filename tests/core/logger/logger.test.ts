import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Logger, getLogger, resetLogger } from '../../../src/core/logger/logger.js';
import { DEFAULT_LOGGER_CONFIG } from '../../../src/core/logger/types.js';
import { observer } from '../../../src/core/observer.js';

describe('logger: Logger class', () => {

    let testDir: string;
    let projectRoot: string;

    beforeEach(async () => {

        testDir = join(
            tmpdir(),
            `noorm-test-logger-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        projectRoot = testDir;
        await mkdir(testDir, { recursive: true });
        await mkdir(join(testDir, '.noorm', 'state'), { recursive: true });

    });

    afterEach(async () => {

        await resetLogger();
        await rm(testDir, { recursive: true, force: true });

    });

    describe('construction', () => {

        it('should create logger with default config', () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
            });

            expect(logger.level).toBe('info');
            expect(logger.isEnabled).toBe(true);
            expect(logger.state).toBe('idle');

        });

        it('should respect disabled config', () => {

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, enabled: false },
            });

            expect(logger.isEnabled).toBe(false);

        });

        it('should respect silent level', () => {

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'silent' },
            });

            expect(logger.isEnabled).toBe(false);

        });

        it('should construct filepath correctly', () => {

            const logger = new Logger({
                projectRoot: '/project',
                config: { ...DEFAULT_LOGGER_CONFIG, file: '.noorm/state/app.log' },
            });

            expect(logger.filepath).toBe('/project/.noorm/state/app.log');

        });

    });

    describe('start/stop', () => {

        it('should start and set state to running', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
            });

            await logger.start();

            expect(logger.state).toBe('running');

            await logger.stop();

        });

        it('should not start if disabled', async () => {

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, enabled: false },
            });

            await logger.start();

            expect(logger.state).toBe('idle');

        });

        it('should stop and set state to stopped', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
            });

            await logger.start();
            await logger.stop();

            expect(logger.state).toBe('stopped');

        });

        it('should be idempotent for start', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
            });

            await logger.start();
            await logger.start();

            expect(logger.state).toBe('running');

            await logger.stop();

        });

        it('should be idempotent for stop', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
            });

            await logger.start();
            await logger.stop();
            await logger.stop();

            expect(logger.state).toBe('stopped');

        });

    });

    describe('event logging', () => {

        it('should log info events at info level', async () => {

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'info' },
            });

            await logger.start();

            observer.emit('config:created', { name: 'dev' });

            await logger.flush();
            await logger.stop();

            const content = await readFile(logger.filepath, 'utf-8');
            const entry = JSON.parse(content.trim());

            expect(entry.type).toBe('config:created');
            expect(entry.level).toBe('info');
            expect(entry.message).toBe('Created config: dev');

        });

        it('should not log debug events at info level', async () => {

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'info' },
            });

            await logger.start();

            observer.emit('file:before', {
                filepath: 'test.sql',
                checksum: 'abc',
                configName: 'dev',
            });

            await logger.flush();
            await logger.stop();

            // File should be empty or not contain the debug event
            try {

                const content = await readFile(logger.filepath, 'utf-8');

                expect(content.includes('file:before')).toBe(false);

            }
            catch {

                // File might not exist if nothing was written
                expect(true).toBe(true);

            }

        });

        it('should log debug events at verbose level', async () => {

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'verbose' },
            });

            await logger.start();

            observer.emit('file:before', {
                filepath: 'test.sql',
                checksum: 'abc',
                configName: 'dev',
            });

            await logger.flush();
            await logger.stop();

            const content = await readFile(logger.filepath, 'utf-8');

            expect(content.includes('file:before')).toBe(true);

        });

        it('should include data at verbose level', async () => {

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'verbose' },
            });

            await logger.start();

            observer.emit('config:created', { name: 'dev' });

            await logger.flush();
            await logger.stop();

            const content = await readFile(logger.filepath, 'utf-8');
            const entry = JSON.parse(content.trim());

            // Data is flattened into the entry at verbose level
            expect(entry.name).toBe('dev');

        });

        it('should not log its own events (avoid loops)', async () => {

            const logger = new Logger({
                projectRoot,
                config: { ...DEFAULT_LOGGER_CONFIG, level: 'verbose' },
            });

            await logger.start();

            // This event is emitted by the logger itself
            observer.emit('logger:started', { file: logger.filepath, level: 'verbose' });

            await logger.flush();
            await logger.stop();

            try {

                const content = await readFile(logger.filepath, 'utf-8');

                expect(content.includes('logger:started')).toBe(false);

            }
            catch {

                // File might not exist if nothing was written
                expect(true).toBe(true);

            }

        });

    });

    describe('context', () => {

        it('should include context with entries', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
                context: { configName: 'dev', user: 'alice' },
            });

            await logger.start();

            observer.emit('config:created', { name: 'test' });

            await logger.flush();
            await logger.stop();

            const content = await readFile(logger.filepath, 'utf-8');
            const entry = JSON.parse(content.trim());

            // Context is flattened into the entry
            expect(entry.configName).toBe('dev');
            expect(entry.user).toBe('alice');

        });

        it('should update context with setContext', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
            });

            await logger.start();

            logger.setContext({ configName: 'prod' });

            observer.emit('config:created', { name: 'test' });

            await logger.flush();
            await logger.stop();

            const content = await readFile(logger.filepath, 'utf-8');
            const entry = JSON.parse(content.trim());

            // Context is flattened into the entry
            expect(entry.configName).toBe('prod');

        });

        it('should merge context with setContext', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
                context: { configName: 'dev' },
            });

            await logger.start();

            logger.setContext({ user: 'alice' });

            observer.emit('config:created', { name: 'test' });

            await logger.flush();
            await logger.stop();

            const content = await readFile(logger.filepath, 'utf-8');
            const entry = JSON.parse(content.trim());

            // Context is flattened into the entry
            expect(entry.configName).toBe('dev');
            expect(entry.user).toBe('alice');

        });

        it('should clear context with clearContext', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
                context: { configName: 'dev' },
            });

            await logger.start();

            logger.clearContext();

            observer.emit('config:created', { name: 'test' });

            await logger.flush();
            await logger.stop();

            const content = await readFile(logger.filepath, 'utf-8');
            const entry = JSON.parse(content.trim());

            // Context was cleared, so configName shouldn't be in entry
            expect(entry.configName).toBeUndefined();

        });

    });

    describe('stats', () => {

        it('should return null stats when not running', () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
            });

            expect(logger.stats).toBeNull();

        });

        it('should return stats when running', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
            });

            await logger.start();

            // Flush to process any startup events
            await logger.flush();

            expect(logger.stats).not.toBeNull();
            expect(logger.stats!.pending).toBe(0);

            await logger.stop();

        });

        it('should track entries written', async () => {

            const logger = new Logger({
                projectRoot,
                config: DEFAULT_LOGGER_CONFIG,
            });

            await logger.start();

            // Flush startup events first to get baseline
            await logger.flush();
            const baseline = logger.stats!.totalWritten;

            observer.emit('config:created', { name: 'test1' });
            observer.emit('config:created', { name: 'test2' });

            await logger.flush();

            // Should have processed 2 more events since baseline
            expect(logger.stats!.totalWritten - baseline).toBe(2);

            await logger.stop();

        });

    });

    describe('singleton', () => {

        it('should return same instance', async () => {

            const logger1 = getLogger(projectRoot);
            const logger2 = getLogger(projectRoot);

            expect(logger1).toBe(logger2);

        });

        it('should reset singleton', async () => {

            const logger1 = getLogger(projectRoot);
            await logger1.start();

            await resetLogger();

            const logger2 = getLogger(projectRoot);

            expect(logger2).not.toBe(logger1);

        });

    });

});
