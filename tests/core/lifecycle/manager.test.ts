import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    LifecycleManager,
    getLifecycleManager,
    resetLifecycleManager,
} from '../../../src/core/lifecycle/manager.js';
import {
    removeAllHandlers,
    hasSignalHandlers,
    hasExceptionHandlers,
} from '../../../src/core/lifecycle/handlers.js';
import { DEFAULT_TIMEOUTS } from '../../../src/core/lifecycle/types.js';
import { observer } from '../../../src/core/observer.js';

describe('lifecycle: LifecycleManager', () => {

    beforeEach(async () => {

        await resetLifecycleManager();
        removeAllHandlers();

    });

    afterEach(async () => {

        await resetLifecycleManager();
        removeAllHandlers();

    });

    describe('construction', () => {

        it('should create with project root', () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
            });

            expect(manager.state).toBe('idle');

        });

        it('should use default mode', () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
            });

            expect(manager.mode).toBe('tui');

        });

        it('should accept custom mode', () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                mode: 'headless',
            });

            expect(manager.mode).toBe('headless');

        });

        it('should accept custom timeouts', () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                timeouts: {
                    ...DEFAULT_TIMEOUTS,
                    operations: 60000,
                },
            });

            expect(manager.state).toBe('idle');

        });

        it('should not be running initially', () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
            });

            expect(manager.isRunning).toBe(false);

        });

        it('should have exit code 0 initially', () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
            });

            expect(manager.exitCode).toBe(0);

        });

    });

    describe('start', () => {

        it('should transition to running state', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();

            expect(manager.state).toBe('running');
            expect(manager.isRunning).toBe(true);

        });

        it('should set startedAt', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            const before = new Date();
            await manager.start();
            const after = new Date();

            expect(manager.startedAt).toBeInstanceOf(Date);
            expect(manager.startedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(manager.startedAt!.getTime()).toBeLessThanOrEqual(after.getTime());

        });

        it('should register signal handlers when enabled', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: true,
            });

            await manager.start();

            expect(hasSignalHandlers()).toBe(true);
            expect(hasExceptionHandlers()).toBe(true);

            await manager.shutdown();

        });

        it('should not register signal handlers when disabled', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();

            expect(hasSignalHandlers()).toBe(false);
            expect(hasExceptionHandlers()).toBe(false);

        });

        it('should emit app:starting event', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            const events: unknown[] = [];
            const cleanup = observer.on('app:starting', (data) => events.push(data));

            await manager.start();

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ mode: 'tui' });

            cleanup();

        });

        it('should emit app:ready event', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            const events: unknown[] = [];
            const cleanup = observer.on('app:ready', (data) => events.push(data));

            await manager.start();

            expect(events).toHaveLength(1);
            expect((events[0] as { mode: string }).mode).toBe('tui');
            expect((events[0] as { startedAt: Date }).startedAt).toBeInstanceOf(Date);

            cleanup();

        });

        it('should throw if already started', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();

            await expect(manager.start()).rejects.toThrow('Cannot start from state');

        });

    });

    describe('shutdown', () => {

        it('should transition to stopped state', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();
            await manager.shutdown();

            expect(manager.state).toBe('stopped');

        });

        it('should accept shutdown reason', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();
            await manager.shutdown('user');

            const state = manager.getState();

            expect(state.shutdownReason).toBe('user');

        });

        it('should accept exit code', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();
            await manager.shutdown('programmatic', 42);

            expect(manager.exitCode).toBe(42);

        });

        it('should emit app:shutdown event', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();

            const events: unknown[] = [];
            const cleanup = observer.on('app:shutdown', (data) => events.push(data));

            await manager.shutdown('user', 0);

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ reason: 'user', exitCode: 0 });

            cleanup();

        });

        it('should emit app:exit event', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();

            const events: unknown[] = [];
            const cleanup = observer.on('app:exit', (data) => events.push(data));

            await manager.shutdown();

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ code: 0 });

            cleanup();

        });

        it('should emit shutdown phase events', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();

            const events: unknown[] = [];
            const cleanup = observer.on('app:shutdown:phase', (data) => events.push(data));

            await manager.shutdown();

            // Should have events for multiple phases
            expect(events.length).toBeGreaterThan(0);

            cleanup();

        });

        it('should be idempotent', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();
            await manager.shutdown();
            await manager.shutdown();

            expect(manager.state).toBe('stopped');

        });

        it('should do nothing if not running', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.shutdown();

            expect(manager.state).toBe('idle');

        });

        it('should remove signal handlers', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: true,
            });

            await manager.start();
            expect(hasSignalHandlers()).toBe(true);

            await manager.shutdown();
            expect(hasSignalHandlers()).toBe(false);

        });

    });

    describe('registerResource', () => {

        it('should register cleanup resource', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            const cleanup = vi.fn();

            manager.registerResource({
                name: 'test',
                phase: 'releasing',
                cleanup: async () => cleanup(),
            });

            await manager.start();
            await manager.shutdown();

            expect(cleanup).toHaveBeenCalled();

        });

        it('should call resources in phase order', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            const order: string[] = [];

            manager.registerResource({
                name: 'flushing-resource',
                phase: 'flushing',
                cleanup: async () => {

                    order.push('flushing');

                },
            });

            manager.registerResource({
                name: 'releasing-resource',
                phase: 'releasing',
                cleanup: async () => {

                    order.push('releasing');

                },
            });

            await manager.start();
            await manager.shutdown();

            expect(order).toEqual(['releasing', 'flushing']);

        });

        it('should respect priority within phase', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            const order: string[] = [];

            manager.registerResource({
                name: 'low-priority',
                phase: 'releasing',
                priority: 10,
                cleanup: async () => {

                    order.push('low');

                },
            });

            manager.registerResource({
                name: 'high-priority',
                phase: 'releasing',
                priority: 0,
                cleanup: async () => {

                    order.push('high');

                },
            });

            await manager.start();
            await manager.shutdown();

            expect(order).toEqual(['high', 'low']);

        });

        it('should emit error event on cleanup failure', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            manager.registerResource({
                name: 'failing',
                phase: 'releasing',
                cleanup: async () => {

                    throw new Error('Cleanup failed');

                },
            });

            const events: unknown[] = [];
            const cleanup = observer.on('error', (data) => events.push(data));

            await manager.start();
            await manager.shutdown();

            expect(events.length).toBeGreaterThan(0);
            const errorEvent = events.find(
                (e: unknown) => (e as { source: string }).source === 'lifecycle',
            );
            expect(errorEvent).toBeDefined();

            cleanup();

        });

    });

    describe('unregisterResource', () => {

        it('should unregister resource', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            const cleanup = vi.fn();

            manager.registerResource({
                name: 'test',
                phase: 'releasing',
                cleanup: async () => cleanup(),
            });

            const removed = manager.unregisterResource('test');

            expect(removed).toBe(true);

            await manager.start();
            await manager.shutdown();

            expect(cleanup).not.toHaveBeenCalled();

        });

        it('should return false for non-existent resource', () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
            });

            const removed = manager.unregisterResource('nonexistent');

            expect(removed).toBe(false);

        });

    });

    describe('setExitCode', () => {

        it('should set exit code', () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
            });

            manager.setExitCode(42);

            expect(manager.exitCode).toBe(42);

        });

    });

    describe('getState', () => {

        it('should return full state', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();

            const state = manager.getState();

            expect(state.state).toBe('running');
            expect(state.mode).toBe('tui');
            expect(state.startedAt).toBeInstanceOf(Date);
            expect(state.exitCode).toBe(0);

        });

        it('should include shutdown info after shutdown', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();
            await manager.shutdown('user', 1);

            const state = manager.getState();

            expect(state.state).toBe('stopped');
            expect(state.shutdownReason).toBe('user');
            expect(state.shuttingDownAt).toBeInstanceOf(Date);
            expect(state.exitCode).toBe(1);

        });

    });

    describe('isShuttingDown', () => {

        it('should return false when not shutting down', async () => {

            const manager = new LifecycleManager({
                projectRoot: '/project',
                registerSignalHandlers: false,
            });

            await manager.start();

            expect(manager.isShuttingDown).toBe(false);

        });

    });

});

describe('lifecycle: singleton', () => {

    beforeEach(async () => {

        await resetLifecycleManager();
        removeAllHandlers();

    });

    afterEach(async () => {

        await resetLifecycleManager();
        removeAllHandlers();

    });

    describe('getLifecycleManager', () => {

        it('should return same instance', () => {

            const manager1 = getLifecycleManager('/project');
            const manager2 = getLifecycleManager();

            expect(manager1).toBe(manager2);

        });

        it('should throw if no projectRoot on first call', () => {

            expect(() => getLifecycleManager()).toThrow('projectRoot is required');

        });

        it('should accept config on first call', () => {

            const manager = getLifecycleManager('/project', { mode: 'headless' });

            expect(manager.mode).toBe('headless');

        });

    });

    describe('resetLifecycleManager', () => {

        it('should reset singleton', async () => {

            const manager1 = getLifecycleManager('/project');
            await resetLifecycleManager();
            const manager2 = getLifecycleManager('/project2');

            expect(manager1).not.toBe(manager2);

        });

        it('should shutdown running manager', async () => {

            const manager = getLifecycleManager('/project', {
                registerSignalHandlers: false,
            });
            await manager.start();

            expect(manager.isRunning).toBe(true);

            await resetLifecycleManager();

            expect(manager.state).toBe('stopped');

        });

        it('should be idempotent', async () => {

            await resetLifecycleManager();
            await resetLifecycleManager();

            // Should not throw
            expect(true).toBe(true);

        });

    });

});
