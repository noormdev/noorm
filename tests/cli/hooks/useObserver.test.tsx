/**
 * Observer hooks tests.
 *
 * Tests useOnEvent, useOnceEvent, useEmit, and useEventPromise.
 */
import { afterEach, describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React, { useEffect, useState } from 'react';
import { Text } from 'ink';

import { observer } from '../../../src/core/observer.js';
import { NoormObserver } from '../../../src/cli/observer-context.js';
import {
    useOnEvent,
    useOnceEvent,
    useEmit,
    useEventPromise,
} from '../../../src/cli/hooks/useObserver.js';

/**
 * Wrap component with NoormObserver provider for testing.
 */
function WithProvider({ children }: { children: React.ReactNode }) {

    return <NoormObserver>{children}</NoormObserver>;

}

describe('cli: hooks/useObserver', () => {

    afterEach(() => {

        observer.clear();

    });

    describe('useOnEvent', () => {

        it('should subscribe to events and receive data', { retry: 2 }, async () => {

            function Subscriber() {

                const [received, setReceived] = useState<string | null>(null);

                useOnEvent(
                    'config:created',
                    (data) => {

                        setReceived(data.name);

                    },
                    [],
                );

                return <Text>received:{received ?? 'none'}</Text>;

            }

            const { lastFrame, unmount } = render(<WithProvider><Subscriber /></WithProvider>);

            expect(lastFrame()).toContain('received:none');

            await new Promise((r) => setTimeout(r, 10));
            observer.emit('config:created', { name: 'test-config' });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('received:test-config');

            unmount();

        });

        it('should receive multiple events', async () => {

            function Counter() {

                const [count, setCount] = useState(0);

                useOnEvent(
                    'config:created',
                    () => {

                        setCount((c) => c + 1);

                    },
                    [],
                );

                return <Text>count:{count}</Text>;

            }

            const { lastFrame, unmount } = render(<WithProvider><Counter /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            observer.emit('config:created', { name: 'first' });
            observer.emit('config:created', { name: 'second' });
            observer.emit('config:created', { name: 'third' });

            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('count:3');

            unmount();

        });

        it('should cleanup on unmount', async () => {

            let callCount = 0;

            function Subscriber() {

                useOnEvent(
                    'config:created',
                    () => {

                        callCount++;

                    },
                    [],
                );

                return <Text>subscribed</Text>;

            }

            const { unmount } = render(<WithProvider><Subscriber /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            observer.emit('config:created', { name: 'before-unmount' });
            await new Promise((r) => setTimeout(r, 10));

            expect(callCount).toBe(1);

            unmount();

            observer.emit('config:created', { name: 'after-unmount' });
            await new Promise((r) => setTimeout(r, 10));

            expect(callCount).toBe(1);

        });

        it('should use latest callback via ref', { retry: 2 }, async () => {

            function DynamicCallback() {

                const [prefix, setPrefix] = useState('A');
                const [received, setReceived] = useState<string>('');

                useOnEvent(
                    'config:created',
                    (data) => {

                        setReceived(`${prefix}:${data.name}`);

                    },
                    [prefix],
                );

                useEffect(() => {

                    const timer = setTimeout(() => setPrefix('B'), 30);

                    return () => clearTimeout(timer);

                }, []);

                return (
                    <Text>
                        received:{received}|prefix:{prefix}
                    </Text>
                );

            }

            const { lastFrame, unmount } = render(<WithProvider><DynamicCallback /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            observer.emit('config:created', { name: 'test' });
            await new Promise((r) => setTimeout(r, 20));

            expect(lastFrame()).toContain('received:A:test');

            // Wait for prefix to change and effect to re-run
            await new Promise((r) => setTimeout(r, 100));

            observer.emit('config:created', { name: 'test2' });
            await new Promise((r) => setTimeout(r, 20));

            expect(lastFrame()).toContain('received:B:test2');

            unmount();

        });

    });

    describe('useOnceEvent', () => {

        it('should only receive first event', async () => {

            function OnceSubscriber() {

                const [received, setReceived] = useState<string[]>([]);

                useOnceEvent(
                    'config:deleted',
                    (data) => {

                        setReceived((prev) => [...prev, data.name]);

                    },
                    [],
                );

                return <Text>received:{received.join(',') || 'none'}</Text>;

            }

            const { lastFrame, unmount } = render(<WithProvider><OnceSubscriber /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            observer.emit('config:deleted', { name: 'first' });
            observer.emit('config:deleted', { name: 'second' });
            observer.emit('config:deleted', { name: 'third' });

            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('received:first');
            expect(lastFrame()).not.toContain('second');

            unmount();

        });

        it('should cleanup on unmount before event fires', async () => {

            let callCount = 0;

            function OnceSubscriber() {

                useOnceEvent(
                    'config:deleted',
                    () => {

                        callCount++;

                    },
                    [],
                );

                return <Text>waiting</Text>;

            }

            const { unmount } = render(<WithProvider><OnceSubscriber /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            unmount();

            observer.emit('config:deleted', { name: 'after-unmount' });
            await new Promise((r) => setTimeout(r, 10));

            expect(callCount).toBe(0);

        });

    });

    describe('useEmit', () => {

        it('should return stable callback that emits events', async () => {

            let receivedData: { name: string } | null = null;
            const cleanup = observer.on('config:created', (data) => {

                receivedData = data;

            });

            function Emitter() {

                const emit = useEmit('config:created');

                useEffect(() => {

                    emit({ name: 'emitted-config' });

                }, [emit]);

                return <Text>emitted</Text>;

            }

            const { unmount } = render(<WithProvider><Emitter /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            expect(receivedData).toEqual({ name: 'emitted-config' });

            unmount();
            cleanup();

        });

        it('should update callback when deps change', async () => {

            const received: string[] = [];
            const cleanup = observer.on('config:created', (data) => {

                received.push(data.name);

            });

            function DynamicEmitter() {

                const [name, setName] = useState('first');
                const emit = useEmit('config:created', [name]);

                useEffect(() => {

                    emit({ name });

                }, [emit, name]);

                useEffect(() => {

                    const timer = setTimeout(() => setName('second'), 30);

                    return () => clearTimeout(timer);

                }, []);

                return <Text>name:{name}</Text>;

            }

            const { unmount } = render(<WithProvider><DynamicEmitter /></WithProvider>);

            await new Promise((r) => setTimeout(r, 100));

            expect(received).toContain('first');
            expect(received).toContain('second');

            unmount();
            cleanup();

        });

    });

    describe('useEventPromise', () => {

        it('should start in pending state', () => {

            function PromiseUser() {

                const [value, error, pending] = useEventPromise('build:complete');

                return (
                    <Text>
                        pending:{String(pending)}|value:{value ? 'yes' : 'no'}|error:
                        {error ? 'yes' : 'no'}
                    </Text>
                );

            }

            const { lastFrame, unmount } = render(<WithProvider><PromiseUser /></WithProvider>);

            expect(lastFrame()).toContain('pending:true');
            expect(lastFrame()).toContain('value:no');
            expect(lastFrame()).toContain('error:no');

            unmount();

        });

        it('should resolve with value when event fires', async () => {

            function PromiseUser() {

                const [value, _error, pending] = useEventPromise('build:complete');

                return (
                    <Text>
                        pending:{String(pending)}|status:{value?.status ?? 'none'}
                    </Text>
                );

            }

            const { lastFrame, unmount } = render(<WithProvider><PromiseUser /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            observer.emit('build:complete', {
                status: 'success',
                filesRun: 5,
                filesSkipped: 2,
                filesFailed: 0,
                durationMs: 1234,
            });

            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('pending:false');
            expect(lastFrame()).toContain('status:success');

            unmount();

        });

        it('should allow cancellation', async () => {

            function CancellableUser() {

                const [value, _error, pending, cancel] = useEventPromise('build:complete');

                useEffect(() => {

                    const timer = setTimeout(() => cancel(), 20);

                    return () => clearTimeout(timer);

                }, [cancel]);

                return (
                    <Text>
                        pending:{String(pending)}|value:{value ? 'yes' : 'no'}
                    </Text>
                );

            }

            const { lastFrame, unmount } = render(<WithProvider><CancellableUser /></WithProvider>);

            await new Promise((r) => setTimeout(r, 50));

            // After cancellation, the subscription is removed but pending stays true
            // (no event was received to resolve it) — this is @logosdx/react behavior
            expect(lastFrame()).toContain('pending:true');
            expect(lastFrame()).toContain('value:no');

            unmount();

        });

        it('should cleanup on unmount', async () => {

            let resolveCount = 0;

            function PromiseUser() {

                const [value] = useEventPromise('build:complete');

                useEffect(() => {

                    if (value) resolveCount++;

                }, [value]);

                return <Text>waiting</Text>;

            }

            const { unmount } = render(<WithProvider><PromiseUser /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            unmount();

            observer.emit('build:complete', {
                status: 'success',
                filesRun: 0,
                filesSkipped: 0,
                filesFailed: 0,
                durationMs: 0,
            });

            await new Promise((r) => setTimeout(r, 10));

            expect(resolveCount).toBe(0);

        });

    });

});
