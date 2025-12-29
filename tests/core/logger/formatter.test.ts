import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    generateMessage,
    formatEntry,
    serializeEntry,
} from '../../../src/core/logger/formatter.js';

describe('logger: formatter', () => {

    beforeEach(() => {

        // Mock Date.now for consistent timestamps
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));

    });

    afterEach(() => {

        vi.useRealTimers();

    });

    describe('generateMessage', () => {

        it('should generate message for file:before event', () => {

            const message = generateMessage('file:before', { filepath: 'schema/001_users.sql' });

            expect(message).toBe('Executing schema/001_users.sql');

        });

        it('should generate message for file:after success', () => {

            const message = generateMessage('file:after', {
                filepath: 'schema/001_users.sql',
                status: 'success',
                durationMs: 45,
            });

            expect(message).toBe('Executed schema/001_users.sql (45ms)');

        });

        it('should generate message for file:after failure', () => {

            const message = generateMessage('file:after', {
                filepath: 'schema/001_users.sql',
                status: 'failed',
                error: 'syntax error',
            });

            expect(message).toBe('Failed schema/001_users.sql: syntax error');

        });

        it('should generate message for build:start', () => {

            const message = generateMessage('build:start', { fileCount: 10 });

            expect(message).toBe('Starting schema build (10 files)');

        });

        it('should generate message for build:complete success', () => {

            const message = generateMessage('build:complete', {
                status: 'success',
                filesRun: 10,
                filesSkipped: 2,
                durationMs: 1234,
            });

            expect(message).toBe('Build complete: 10 run, 2 skipped (1234ms)');

        });

        it('should generate message for build:complete failure', () => {

            const message = generateMessage('build:complete', {
                status: 'failed',
                filesRun: 5,
                durationMs: 567,
            });

            expect(message).toBe('Build failed after 5 files (567ms)');

        });

        it('should generate message for config:created', () => {

            const message = generateMessage('config:created', { name: 'dev' });

            expect(message).toBe('Created config: dev');

        });

        it('should generate message for config:activated with previous', () => {

            const message = generateMessage('config:activated', {
                name: 'prod',
                previous: 'dev',
            });

            expect(message).toBe('Activated config: prod (was dev)');

        });

        it('should generate message for config:activated without previous', () => {

            const message = generateMessage('config:activated', {
                name: 'prod',
                previous: null,
            });

            expect(message).toBe('Activated config: prod');

        });

        it('should generate generic message for unknown events', () => {

            const message = generateMessage('custom:event', {
                foo: 'bar',
                count: 42,
            });

            expect(message).toBe('custom event: foo="bar", count=42');

        });

        it('should generate generic message for empty data', () => {

            const message = generateMessage('custom:event', {});

            expect(message).toBe('custom event');

        });

        it('should truncate long string values in generic message', () => {

            const longString = 'a'.repeat(100);
            const message = generateMessage('custom:event', { value: longString });

            expect(message).toContain('...');

        });

    });

    describe('formatEntry', () => {

        it('should create log entry with required fields', () => {

            const entry = formatEntry('build:start', { fileCount: 10 });

            expect(entry.timestamp).toBe('2024-01-15T10:30:00.000Z');
            expect(entry.level).toBe('info');
            expect(entry.event).toBe('build:start');
            expect(entry.message).toBe('Starting schema build (10 files)');

        });

        it('should not include data by default', () => {

            const entry = formatEntry('build:start', { fileCount: 10 });

            expect(entry.data).toBeUndefined();

        });

        it('should include data when includeData is true', () => {

            const entry = formatEntry('build:start', { fileCount: 10 }, undefined, true);

            expect(entry.data).toEqual({ fileCount: 10 });

        });

        it('should include context when provided', () => {

            const entry = formatEntry('build:start', { fileCount: 10 }, { config: 'dev' });

            expect(entry.context).toEqual({ config: 'dev' });

        });

        it('should not include empty context', () => {

            const entry = formatEntry('build:start', { fileCount: 10 }, {});

            expect(entry.context).toBeUndefined();

        });

        it('should redact sensitive fields in data', () => {

            const entry = formatEntry(
                'custom:event',
                { username: 'alice', password: 'secret123' },
                undefined,
                true,
            );

            expect(entry.data?.['username']).toBe('alice');
            expect(entry.data?.['password']).toBe('[REDACTED]');

        });

        it('should redact fields containing "secret"', () => {

            const entry = formatEntry('custom:event', { mySecretValue: 'hidden' }, undefined, true);

            expect(entry.data?.['mySecretValue']).toBe('[REDACTED]');

        });

        it('should redact fields containing "token"', () => {

            const entry = formatEntry('custom:event', { accessToken: 'abc123' }, undefined, true);

            expect(entry.data?.['accessToken']).toBe('[REDACTED]');

        });

        it('should handle Error objects in data', () => {

            const error = new Error('test error');
            const entry = formatEntry('error', { source: 'test', error }, undefined, true);

            const errorData = entry.data?.['error'] as { name: string; message: string };

            expect(errorData.name).toBe('Error');
            expect(errorData.message).toBe('test error');

        });

        it('should handle Date objects in data', () => {

            const date = new Date('2024-01-15T12:00:00.000Z');
            const entry = formatEntry('custom:event', { timestamp: date }, undefined, true);

            expect(entry.data?.['timestamp']).toBe('2024-01-15T12:00:00.000Z');

        });

        it('should classify error events correctly', () => {

            const entry = formatEntry('connection:error', { configName: 'dev', error: 'timeout' });

            expect(entry.level).toBe('error');

        });

        it('should classify warn events correctly', () => {

            const entry = formatEntry('lock:blocked', { configName: 'dev', holder: 'alice' });

            expect(entry.level).toBe('warn');

        });

        it('should classify debug events correctly', () => {

            const entry = formatEntry('file:before', { filepath: 'test.sql' });

            expect(entry.level).toBe('debug');

        });

    });

    describe('serializeEntry', () => {

        it('should serialize entry to JSON with newline', () => {

            const entry = {
                timestamp: '2024-01-15T10:30:00.000Z',
                level: 'info' as const,
                event: 'build:start',
                message: 'Starting schema build (10 files)',
            };

            const line = serializeEntry(entry);

            expect(line).toBe(JSON.stringify(entry) + '\n');
            expect(line.endsWith('\n')).toBe(true);

        });

        it('should include all fields in serialized output', () => {

            const entry = {
                timestamp: '2024-01-15T10:30:00.000Z',
                level: 'info' as const,
                event: 'build:start',
                message: 'Starting build',
                data: { fileCount: 10 },
                context: { config: 'dev' },
            };

            const line = serializeEntry(entry);
            const parsed = JSON.parse(line.trim());

            expect(parsed.timestamp).toBe(entry.timestamp);
            expect(parsed.level).toBe(entry.level);
            expect(parsed.event).toBe(entry.event);
            expect(parsed.message).toBe(entry.message);
            expect(parsed.data).toEqual(entry.data);
            expect(parsed.context).toEqual(entry.context);

        });

    });

});
