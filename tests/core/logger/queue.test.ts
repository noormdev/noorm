import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { WriteQueue } from '../../../src/core/logger/queue.js';

describe('logger: queue', () => {

    let testDir: string;
    let logFile: string;
    let queue: WriteQueue;

    beforeEach(async () => {

        testDir = join(
            tmpdir(),
            `noorm-test-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        await mkdir(testDir, { recursive: true });
        logFile = join(testDir, 'test.log');
        queue = new WriteQueue(logFile);

    });

    afterEach(async () => {

        if (queue.isRunning) {

            await queue.stop();

        }

        await rm(testDir, { recursive: true, force: true });

    });

    describe('construction', () => {

        it('should create queue with filepath', () => {

            expect(queue.filepath).toBe(logFile);

        });

        it('should not be running initially', () => {

            expect(queue.isRunning).toBe(false);

        });

        it('should have zero stats initially', () => {

            expect(queue.stats.pending).toBe(0);
            expect(queue.stats.totalWritten).toBe(0);
            expect(queue.stats.totalBytes).toBe(0);
            expect(queue.stats.isWriting).toBe(false);

        });

    });

    describe('start/stop', () => {

        it('should start successfully', async () => {

            await queue.start();

            expect(queue.isRunning).toBe(true);

        });

        it('should create directory if needed', async () => {

            const nestedPath = join(testDir, 'nested', 'deep', 'test.log');
            const nestedQueue = new WriteQueue(nestedPath);

            await nestedQueue.start();

            expect(nestedQueue.isRunning).toBe(true);

            await nestedQueue.stop();

        });

        it('should stop successfully', async () => {

            await queue.start();
            await queue.stop();

            expect(queue.isRunning).toBe(false);

        });

        it('should be idempotent for start', async () => {

            await queue.start();
            await queue.start();

            expect(queue.isRunning).toBe(true);

        });

        it('should be idempotent for stop', async () => {

            await queue.start();
            await queue.stop();
            await queue.stop();

            expect(queue.isRunning).toBe(false);

        });

    });

    describe('enqueue', () => {

        it('should not enqueue when not started', async () => {

            queue.enqueue('test line\n');

            expect(queue.stats.pending).toBe(0);

        });

        it('should enqueue when running', async () => {

            await queue.start();

            queue.enqueue('test line\n');

            // Give it time to process
            await queue.flush();

            expect(queue.stats.totalWritten).toBe(1);

        });

        it('should write multiple entries in order', async () => {

            await queue.start();

            queue.enqueue('line 1\n');
            queue.enqueue('line 2\n');
            queue.enqueue('line 3\n');

            await queue.flush();

            const content = await readFile(logFile, 'utf-8');

            expect(content).toBe('line 1\nline 2\nline 3\n');

        });

        it('should track total bytes written', async () => {

            await queue.start();

            queue.enqueue('hello world\n'); // 12 bytes

            await queue.flush();

            expect(queue.stats.totalBytes).toBe(12);

        });

        it('should not enqueue when stopping', async () => {

            await queue.start();

            queue.enqueue('first\n');
            await queue.flush();

            // Start stopping
            const stopPromise = queue.stop();

            // Try to enqueue during stop
            queue.enqueue('should not be written\n');

            await stopPromise;

            const content = await readFile(logFile, 'utf-8');

            expect(content).toBe('first\n');

        });

    });

    describe('flush', () => {

        it('should resolve immediately when queue is empty', async () => {

            await queue.start();

            await expect(queue.flush()).resolves.toBeUndefined();

        });

        it('should wait for pending writes', async () => {

            await queue.start();

            queue.enqueue('line 1\n');
            queue.enqueue('line 2\n');

            await queue.flush();

            expect(queue.stats.pending).toBe(0);
            expect(queue.stats.totalWritten).toBe(2);

        });

        it('should allow multiple flush calls', async () => {

            await queue.start();

            queue.enqueue('line 1\n');

            const [result1, result2] = await Promise.all([queue.flush(), queue.flush()]);

            expect(result1).toBeUndefined();
            expect(result2).toBeUndefined();

            const content = await readFile(logFile, 'utf-8');

            expect(content).toBe('line 1\n');

        });

    });

    describe('setFilepath', () => {

        it('should switch to new file', async () => {

            await queue.start();

            queue.enqueue('old file content\n');
            await queue.flush();

            const newLogFile = join(testDir, 'new.log');
            await queue.setFilepath(newLogFile);

            queue.enqueue('new file content\n');
            await queue.flush();

            const oldContent = await readFile(logFile, 'utf-8');
            const newContent = await readFile(newLogFile, 'utf-8');

            expect(oldContent).toBe('old file content\n');
            expect(newContent).toBe('new file content\n');

        });

        it('should flush before switching', async () => {

            await queue.start();

            queue.enqueue('pending content\n');

            // setFilepath should flush first
            const newLogFile = join(testDir, 'new.log');
            await queue.setFilepath(newLogFile);

            const oldContent = await readFile(logFile, 'utf-8');

            expect(oldContent).toBe('pending content\n');

        });

    });

    describe('stop with pending writes', () => {

        it('should flush before stopping', async () => {

            await queue.start();

            queue.enqueue('line 1\n');
            queue.enqueue('line 2\n');
            queue.enqueue('line 3\n');

            await queue.stop();

            const content = await readFile(logFile, 'utf-8');

            expect(content).toBe('line 1\nline 2\nline 3\n');
            expect(queue.stats.totalWritten).toBe(3);

        });

    });

});
