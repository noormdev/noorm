import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

import { readLogFile } from '../../../src/core/logger/reader.js';
import type { LogEntry } from '../../../src/core/logger/types.js';

describe('logger: reader', () => {

    const TMP_DIR = path.join(process.cwd(), 'tmp');
    let testFilePath: string;

    beforeEach(async () => {

        // Create unique test file path
        testFilePath = path.join(TMP_DIR, `test-log-${Date.now()}.log`);

        // Ensure tmp directory exists
        await fs.mkdir(TMP_DIR, { recursive: true });

    });

    afterEach(async () => {

        // Clean up test file
        try {

            await fs.unlink(testFilePath);

        }
        catch {

            // File may not exist, ignore
        }

    });

    describe('readLogFile', () => {

        it('should return empty result for missing file', async () => {

            const result = await readLogFile('/non/existent/file.log');

            expect(result.entries).toEqual([]);
            expect(result.totalLines).toBe(0);
            expect(result.hasMore).toBe(false);

        });

        it('should return empty result for empty file', async () => {

            // Create empty file
            await fs.writeFile(testFilePath, '', 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toEqual([]);
            expect(result.totalLines).toBe(0);
            expect(result.hasMore).toBe(false);

        });

        it('should parse valid JSON Lines entries', async () => {

            const entries: LogEntry[] = [
                {
                    timestamp: '2024-01-15T10:00:00.000Z',
                    level: 'info',
                    event: 'build:start',
                    message: 'Starting build',
                },
                {
                    timestamp: '2024-01-15T10:01:00.000Z',
                    level: 'debug',
                    event: 'file:before',
                    message: 'Executing file',
                },
                {
                    timestamp: '2024-01-15T10:02:00.000Z',
                    level: 'error',
                    event: 'build:error',
                    message: 'Build failed',
                },
            ];

            const content = entries.map((e) => JSON.stringify(e)).join('\n');
            await fs.writeFile(testFilePath, content, 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(3);
            expect(result.totalLines).toBe(3);
            expect(result.hasMore).toBe(false);

            // Verify newest first order (reverse chronological)
            expect(result.entries[0].timestamp).toBe('2024-01-15T10:02:00.000Z');
            expect(result.entries[1].timestamp).toBe('2024-01-15T10:01:00.000Z');
            expect(result.entries[2].timestamp).toBe('2024-01-15T10:00:00.000Z');

        });

        it('should skip malformed JSON entries', async () => {

            const validEntry: LogEntry = {
                timestamp: '2024-01-15T10:00:00.000Z',
                level: 'info',
                event: 'build:start',
                message: 'Starting build',
            };

            const content = [
                JSON.stringify(validEntry),
                '{ invalid json',
                'not even close to json',
                JSON.stringify(validEntry),
            ].join('\n');

            await fs.writeFile(testFilePath, content, 'utf-8');

            const result = await readLogFile(testFilePath);

            // Should only parse the 2 valid entries, skip malformed ones
            expect(result.entries).toHaveLength(2);
            expect(result.totalLines).toBe(4);
            expect(result.entries[0].message).toBe('Starting build');
            expect(result.entries[1].message).toBe('Starting build');

        });

        it('should limit entries to specified count', async () => {

            // Create 10 entries
            const entries: LogEntry[] = Array.from({ length: 10 }, (_, i) => ({
                timestamp: `2024-01-15T10:${String(i).padStart(2, '0')}:00.000Z`,
                level: 'info' as const,
                event: 'test:event',
                message: `Entry ${i}`,
            }));

            const content = entries.map((e) => JSON.stringify(e)).join('\n');
            await fs.writeFile(testFilePath, content, 'utf-8');

            const result = await readLogFile(testFilePath, { limit: 5 });

            expect(result.entries).toHaveLength(5);
            expect(result.totalLines).toBe(10);
            expect(result.hasMore).toBe(true);

            // Should return the last 5 entries in reverse order
            expect(result.entries[0].message).toBe('Entry 9');
            expect(result.entries[4].message).toBe('Entry 5');

        });

        it('should return entries in reverse chronological order (newest first)', async () => {

            const entries: LogEntry[] = [
                {
                    timestamp: '2024-01-15T10:00:00.000Z',
                    level: 'info',
                    event: 'first',
                    message: 'First entry',
                },
                {
                    timestamp: '2024-01-15T11:00:00.000Z',
                    level: 'info',
                    event: 'second',
                    message: 'Second entry',
                },
                {
                    timestamp: '2024-01-15T12:00:00.000Z',
                    level: 'info',
                    event: 'third',
                    message: 'Third entry',
                },
            ];

            const content = entries.map((e) => JSON.stringify(e)).join('\n');
            await fs.writeFile(testFilePath, content, 'utf-8');

            const result = await readLogFile(testFilePath);

            // Most recent (third) should be first
            expect(result.entries[0].event).toBe('third');
            expect(result.entries[1].event).toBe('second');
            expect(result.entries[2].event).toBe('first');

        });

        it('should set hasMore correctly when limit exceeded', async () => {

            // Create 100 entries
            const entries: LogEntry[] = Array.from({ length: 100 }, (_, i) => ({
                timestamp: `2024-01-15T10:00:${String(i).padStart(2, '0')}.000Z`,
                level: 'info' as const,
                event: 'test:event',
                message: `Entry ${i}`,
            }));

            const content = entries.map((e) => JSON.stringify(e)).join('\n');
            await fs.writeFile(testFilePath, content, 'utf-8');

            // Test with limit less than total
            const limited = await readLogFile(testFilePath, { limit: 50 });
            expect(limited.hasMore).toBe(true);
            expect(limited.totalLines).toBe(100);

            // Test with limit equal to total
            const exact = await readLogFile(testFilePath, { limit: 100 });
            expect(exact.hasMore).toBe(false);
            expect(exact.totalLines).toBe(100);

            // Test with limit greater than total
            const over = await readLogFile(testFilePath, { limit: 150 });
            expect(over.hasMore).toBe(false);
            expect(over.totalLines).toBe(100);

        });

        it('should handle file with only whitespace', async () => {

            await fs.writeFile(testFilePath, '   \n\n  \n\t\n   ', 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toEqual([]);
            expect(result.totalLines).toBe(0);
            expect(result.hasMore).toBe(false);

        });

        it('should skip entries missing required fields', async () => {

            const validEntry: LogEntry = {
                timestamp: '2024-01-15T10:00:00.000Z',
                level: 'info',
                event: 'valid',
                message: 'Valid entry',
            };

            const invalidEntries = [
                { level: 'info', event: 'test', message: 'Missing timestamp' },
                { timestamp: '2024-01-15T10:00:00.000Z', event: 'test', message: 'Missing level' },
                { timestamp: '2024-01-15T10:00:00.000Z', level: 'info', message: 'Missing event' },
                {
                    timestamp: '2024-01-15T10:00:00.000Z',
                    level: 'info',
                    event: 'test',
                },
            ];

            const content = [
                JSON.stringify(validEntry),
                ...invalidEntries.map((e) => JSON.stringify(e)),
                JSON.stringify(validEntry),
            ].join('\n');

            await fs.writeFile(testFilePath, content, 'utf-8');

            const result = await readLogFile(testFilePath);

            // Should only parse the 2 valid entries
            expect(result.entries).toHaveLength(2);
            expect(result.entries[0].event).toBe('valid');
            expect(result.entries[1].event).toBe('valid');

        });

        it('should handle entries with optional data and context fields', async () => {

            const entryWithExtras: LogEntry = {
                timestamp: '2024-01-15T10:00:00.000Z',
                level: 'info',
                event: 'build:start',
                message: 'Starting build',
                data: { fileCount: 10 },
                context: { config: 'dev' },
            };

            await fs.writeFile(testFilePath, JSON.stringify(entryWithExtras), 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(1);
            expect(result.entries[0].data).toEqual({ fileCount: 10 });
            expect(result.entries[0].context).toEqual({ config: 'dev' });

        });

        it('should use default limit of 500', async () => {

            // Create 600 entries
            const entries: LogEntry[] = Array.from({ length: 600 }, (_, i) => ({
                timestamp: `2024-01-15T10:00:${String(i % 60).padStart(2, '0')}.${String(Math.floor(i / 60)).padStart(3, '0')}Z`,
                level: 'info' as const,
                event: 'test:event',
                message: `Entry ${i}`,
            }));

            const content = entries.map((e) => JSON.stringify(e)).join('\n');
            await fs.writeFile(testFilePath, content, 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(500);
            expect(result.totalLines).toBe(600);
            expect(result.hasMore).toBe(true);

        });

    });

    describe('isValidLogEntry', () => {

        // Note: isValidLogEntry is not exported, so we test it indirectly
        // through readLogFile by checking which entries get parsed

        it('should return true for valid entry with required fields', async () => {

            const validEntry: LogEntry = {
                timestamp: '2024-01-15T10:00:00.000Z',
                level: 'info',
                event: 'test',
                message: 'Test message',
            };

            await fs.writeFile(testFilePath, JSON.stringify(validEntry), 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(1);
            expect(result.entries[0]).toMatchObject(validEntry);

        });

        it('should return false for missing timestamp', async () => {

            const invalidEntry = {
                level: 'info',
                event: 'test',
                message: 'Missing timestamp',
            };

            await fs.writeFile(testFilePath, JSON.stringify(invalidEntry), 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(0);

        });

        it('should return false for missing level', async () => {

            const invalidEntry = {
                timestamp: '2024-01-15T10:00:00.000Z',
                event: 'test',
                message: 'Missing level',
            };

            await fs.writeFile(testFilePath, JSON.stringify(invalidEntry), 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(0);

        });

        it('should return false for non-object input', async () => {

            const primitives = [
                '"string"',
                '42',
                'true',
                'null',
                '["array"]',
            ];

            const content = primitives.join('\n');
            await fs.writeFile(testFilePath, content, 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(0);

        });

        it('should return false for missing event', async () => {

            const invalidEntry = {
                timestamp: '2024-01-15T10:00:00.000Z',
                level: 'info',
                message: 'Missing event',
            };

            await fs.writeFile(testFilePath, JSON.stringify(invalidEntry), 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(0);

        });

        it('should return false for missing message', async () => {

            const invalidEntry = {
                timestamp: '2024-01-15T10:00:00.000Z',
                level: 'info',
                event: 'test',
            };

            await fs.writeFile(testFilePath, JSON.stringify(invalidEntry), 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(0);

        });

        it('should return false for non-string required fields', async () => {

            const invalidEntries = [
                { timestamp: 123, level: 'info', event: 'test', message: 'msg' },
                { timestamp: '2024-01-15T10:00:00.000Z', level: 123, event: 'test', message: 'msg' },
                { timestamp: '2024-01-15T10:00:00.000Z', level: 'info', event: 123, message: 'msg' },
                { timestamp: '2024-01-15T10:00:00.000Z', level: 'info', event: 'test', message: 123 },
            ];

            const content = invalidEntries.map((e) => JSON.stringify(e)).join('\n');
            await fs.writeFile(testFilePath, content, 'utf-8');

            const result = await readLogFile(testFilePath);

            expect(result.entries).toHaveLength(0);

        });

    });

});
