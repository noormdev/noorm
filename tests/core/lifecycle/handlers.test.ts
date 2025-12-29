import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    registerSignalHandlers,
    registerExceptionHandlers,
    removeAllHandlers,
    hasSignalHandlers,
    hasExceptionHandlers,
} from '../../../src/core/lifecycle/handlers.js';
import { observer } from '../../../src/core/observer.js';

describe('lifecycle: handlers', () => {

    beforeEach(() => {

        removeAllHandlers();

    });

    afterEach(() => {

        removeAllHandlers();

    });

    describe('registerSignalHandlers', () => {

        it('should register handlers', () => {

            const callback = vi.fn();
            registerSignalHandlers(callback);

            expect(hasSignalHandlers()).toBe(true);

        });

        it('should return cleanup function', () => {

            const callback = vi.fn();
            const cleanup = registerSignalHandlers(callback);

            expect(typeof cleanup).toBe('function');

        });

        it('should remove handlers on cleanup', () => {

            const callback = vi.fn();
            const cleanup = registerSignalHandlers(callback);

            cleanup();

            expect(hasSignalHandlers()).toBe(false);

        });

        it('should replace existing handlers', () => {

            const callback1 = vi.fn();
            const callback2 = vi.fn();

            registerSignalHandlers(callback1);
            registerSignalHandlers(callback2);

            expect(hasSignalHandlers()).toBe(true);

        });

        it('should emit app:signal event on signal', async () => {

            const events: unknown[] = [];
            const cleanup = observer.on('app:signal', (data) => events.push(data));

            const signalCallback = vi.fn();
            registerSignalHandlers(signalCallback);

            // Simulate signal by calling the process listener directly
            const listeners = process.listeners('SIGINT');
            if (listeners.length > 0) {

                // Call the last registered handler (ours)
                (listeners[listeners.length - 1] as () => void)();

            }

            // Wait for event to be emitted
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ signal: 'SIGINT' });

            cleanup();

        });

    });

    describe('registerExceptionHandlers', () => {

        it('should register handlers', () => {

            const callback = vi.fn();
            registerExceptionHandlers(callback);

            expect(hasExceptionHandlers()).toBe(true);

        });

        it('should return cleanup function', () => {

            const callback = vi.fn();
            const cleanup = registerExceptionHandlers(callback);

            expect(typeof cleanup).toBe('function');

        });

        it('should remove handlers on cleanup', () => {

            const callback = vi.fn();
            const cleanup = registerExceptionHandlers(callback);

            cleanup();

            expect(hasExceptionHandlers()).toBe(false);

        });

        it('should replace existing handlers', () => {

            const callback1 = vi.fn();
            const callback2 = vi.fn();

            registerExceptionHandlers(callback1);
            registerExceptionHandlers(callback2);

            expect(hasExceptionHandlers()).toBe(true);

        });

        it('should emit app:exception on uncaughtException', async () => {

            const events: unknown[] = [];
            const cleanup = observer.on('app:exception', (data) => events.push(data));

            const errorCallback = vi.fn();
            registerExceptionHandlers(errorCallback);

            // Simulate exception by calling the process listener directly
            const error = new Error('Test error');
            const listeners = process.listeners('uncaughtException');
            if (listeners.length > 0) {

                (listeners[listeners.length - 1] as (err: Error) => void)(error);

            }

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(events).toHaveLength(1);
            expect((events[0] as { error: Error }).error.message).toBe('Test error');
            expect((events[0] as { type: string }).type).toBe('exception');

            cleanup();

        });

        it('should emit app:exception on unhandledRejection', async () => {

            const events: unknown[] = [];
            const cleanup = observer.on('app:exception', (data) => events.push(data));

            const errorCallback = vi.fn();
            registerExceptionHandlers(errorCallback);

            // Simulate rejection by calling the process listener directly
            const error = new Error('Rejection error');
            const promise = Promise.reject(error);
            const listeners = process.listeners('unhandledRejection');
            if (listeners.length > 0) {

                (listeners[listeners.length - 1] as (reason: unknown, p: Promise<unknown>) => void)(
                    error,
                    promise,
                );

            }

            // Catch the rejection to prevent actual unhandled rejection
            promise.catch(() => {});

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(events).toHaveLength(1);
            expect((events[0] as { error: Error }).error.message).toBe('Rejection error');
            expect((events[0] as { type: string }).type).toBe('rejection');

            cleanup();

        });

        it('should convert non-Error rejection to Error', async () => {

            const events: unknown[] = [];
            const cleanup = observer.on('app:exception', (data) => events.push(data));

            const errorCallback = vi.fn();
            registerExceptionHandlers(errorCallback);

            // Simulate string rejection
            const promise = Promise.reject('String rejection');
            const listeners = process.listeners('unhandledRejection');
            if (listeners.length > 0) {

                (listeners[listeners.length - 1] as (reason: unknown, p: Promise<unknown>) => void)(
                    'String rejection',
                    promise,
                );

            }

            promise.catch(() => {});

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(events).toHaveLength(1);
            expect((events[0] as { error: Error }).error.message).toBe('String rejection');

            cleanup();

        });

    });

    describe('removeAllHandlers', () => {

        it('should remove signal handlers', () => {

            const callback = vi.fn();
            registerSignalHandlers(callback);

            expect(hasSignalHandlers()).toBe(true);

            removeAllHandlers();

            expect(hasSignalHandlers()).toBe(false);

        });

        it('should remove exception handlers', () => {

            const callback = vi.fn();
            registerExceptionHandlers(callback);

            expect(hasExceptionHandlers()).toBe(true);

            removeAllHandlers();

            expect(hasExceptionHandlers()).toBe(false);

        });

        it('should remove both signal and exception handlers', () => {

            registerSignalHandlers(vi.fn());
            registerExceptionHandlers(vi.fn());

            expect(hasSignalHandlers()).toBe(true);
            expect(hasExceptionHandlers()).toBe(true);

            removeAllHandlers();

            expect(hasSignalHandlers()).toBe(false);
            expect(hasExceptionHandlers()).toBe(false);

        });

        it('should be idempotent', () => {

            removeAllHandlers();
            removeAllHandlers();

            expect(hasSignalHandlers()).toBe(false);
            expect(hasExceptionHandlers()).toBe(false);

        });

    });

    describe('hasSignalHandlers', () => {

        it('should return false initially', () => {

            expect(hasSignalHandlers()).toBe(false);

        });

        it('should return true after registering', () => {

            registerSignalHandlers(vi.fn());

            expect(hasSignalHandlers()).toBe(true);

        });

    });

    describe('hasExceptionHandlers', () => {

        it('should return false initially', () => {

            expect(hasExceptionHandlers()).toBe(false);

        });

        it('should return true after registering', () => {

            registerExceptionHandlers(vi.fn());

            expect(hasExceptionHandlers()).toBe(true);

        });

    });

});
