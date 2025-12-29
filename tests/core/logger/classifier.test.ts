import { describe, it, expect } from 'vitest';

import { classifyEvent, shouldLog } from '../../../src/core/logger/classifier.js';

describe('logger: classifier', () => {

    describe('classifyEvent', () => {

        it('should classify "error" as error level', () => {

            expect(classifyEvent('error')).toBe('error');

        });

        it('should classify events ending with :error as error level', () => {

            expect(classifyEvent('connection:error')).toBe('error');
            expect(classifyEvent('config:error')).toBe('error');

        });

        it('should classify events ending with :failed as error level', () => {

            expect(classifyEvent('file:failed')).toBe('error');
            expect(classifyEvent('build:failed')).toBe('error');

        });

        it('should classify events ending with :warning as warn level', () => {

            expect(classifyEvent('version:warning')).toBe('warn');

        });

        it('should classify events ending with :blocked as warn level', () => {

            expect(classifyEvent('lock:blocked')).toBe('warn');

        });

        it('should classify events ending with :expired as warn level', () => {

            expect(classifyEvent('lock:expired')).toBe('warn');

        });

        it('should classify events ending with :start as info level', () => {

            expect(classifyEvent('build:start')).toBe('info');
            expect(classifyEvent('changeset:start')).toBe('info');

        });

        it('should classify events ending with :complete as info level', () => {

            expect(classifyEvent('build:complete')).toBe('info');
            expect(classifyEvent('changeset:complete')).toBe('info');

        });

        it('should classify events ending with :created as info level', () => {

            expect(classifyEvent('config:created')).toBe('info');
            expect(classifyEvent('db:created')).toBe('info');

        });

        it('should classify events ending with :deleted as info level', () => {

            expect(classifyEvent('config:deleted')).toBe('info');

        });

        it('should classify events ending with :loaded as info level', () => {

            expect(classifyEvent('state:loaded')).toBe('info');
            expect(classifyEvent('settings:loaded')).toBe('info');

        });

        it('should classify events ending with :acquired as info level', () => {

            expect(classifyEvent('lock:acquired')).toBe('info');

        });

        it('should classify events ending with :released as info level', () => {

            expect(classifyEvent('lock:released')).toBe('info');

        });

        it('should classify events ending with :open as info level', () => {

            expect(classifyEvent('connection:open')).toBe('info');

        });

        it('should classify events ending with :close as info level', () => {

            expect(classifyEvent('connection:close')).toBe('info');

        });

        it('should classify other events as debug level', () => {

            expect(classifyEvent('file:before')).toBe('debug');
            expect(classifyEvent('lock:acquiring')).toBe('debug');
            expect(classifyEvent('changeset:file')).toBe('debug');
            expect(classifyEvent('file:skip')).toBe('debug');

        });

    });

    describe('shouldLog', () => {

        it('should return false when level is silent', () => {

            expect(shouldLog('error', 'silent')).toBe(false);
            expect(shouldLog('build:start', 'silent')).toBe(false);

        });

        it('should return true for all events when level is verbose', () => {

            expect(shouldLog('error', 'verbose')).toBe(true);
            expect(shouldLog('file:before', 'verbose')).toBe(true);
            expect(shouldLog('build:start', 'verbose')).toBe(true);

        });

        it('should log errors at error level', () => {

            expect(shouldLog('error', 'error')).toBe(true);
            expect(shouldLog('connection:error', 'error')).toBe(true);

        });

        it('should not log info events at error level', () => {

            expect(shouldLog('build:start', 'error')).toBe(false);

        });

        it('should not log debug events at error level', () => {

            expect(shouldLog('file:before', 'error')).toBe(false);

        });

        it('should log errors and warnings at warn level', () => {

            expect(shouldLog('error', 'warn')).toBe(true);
            expect(shouldLog('lock:blocked', 'warn')).toBe(true);

        });

        it('should not log info events at warn level', () => {

            expect(shouldLog('build:start', 'warn')).toBe(false);

        });

        it('should log errors, warnings, and info at info level', () => {

            expect(shouldLog('error', 'info')).toBe(true);
            expect(shouldLog('lock:blocked', 'info')).toBe(true);
            expect(shouldLog('build:start', 'info')).toBe(true);

        });

        it('should not log debug events at info level', () => {

            expect(shouldLog('file:before', 'info')).toBe(false);

        });

    });

});
