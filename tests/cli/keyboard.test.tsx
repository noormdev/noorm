/**
 * Keyboard handler tests.
 *
 * Tests keyboard hooks and list navigation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React, { useState, useCallback } from 'react';
import { Text } from 'ink';

import { RouterProvider } from '../../src/cli/router.js';
import { FocusProvider, useFocusScope } from '../../src/cli/focus.js';
import { ShutdownProvider } from '../../src/cli/shutdown.js';
import { useFocusedInput, useListKeys, useQuitHandler } from '../../src/cli/keyboard.js';
import { resetLifecycleManager } from '../../src/core/lifecycle/manager.js';

// ANSI escape sequences for arrow keys
const KEYS = {
    UP: '\x1B[A',
    DOWN: '\x1B[B',
    ENTER: '\r',
    ESCAPE: '\x1B',
};

/**
 * Wrapper that provides required context for keyboard hooks.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {

    return (
        <ShutdownProvider projectRoot={process.cwd()}>
            <FocusProvider>
                <RouterProvider>{children}</RouterProvider>
            </FocusProvider>
        </ShutdownProvider>
    );

}

describe('cli: keyboard', () => {

    // Reset lifecycle manager between tests to prevent state conflicts
    beforeEach(async () => {

        await resetLifecycleManager();

    });

    afterEach(async () => {

        await resetLifecycleManager();

    });

    describe('useFocusedInput', () => {

        it('should call handler when focused', { retry: 2 }, async () => {

            const handler = vi.fn();

            function FocusedComponent() {

                const { isFocused } = useFocusScope('test');

                useFocusedInput(isFocused, handler);

                return <Text>focused:{String(isFocused)}</Text>;

            }

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <FocusedComponent />
                </TestWrapper>,
            );

            // Wait for focus to be established
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(lastFrame()).toContain('focused:true');

            stdin.write('x');

            // Wait for handler to be called
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalled();

            unmount();

        });

        it('should not call handler when not focused', () => {

            const handler = vi.fn();

            function UnfocusedComponent() {

                // Always pass false for isFocused
                useFocusedInput(false, handler);

                return <Text>not focused</Text>;

            }

            const { stdin, unmount } = render(
                <TestWrapper>
                    <UnfocusedComponent />
                </TestWrapper>,
            );

            stdin.write('x');

            expect(handler).not.toHaveBeenCalled();

            unmount();

        });

        it('should receive input character and key object', async () => {

            let receivedInput: string | undefined;
            let receivedKey: unknown;

            function InputCapture() {

                const { isFocused } = useFocusScope('test');

                useFocusedInput(isFocused, (input, key) => {

                    receivedInput = input;
                    receivedKey = key;

                });

                return <Text>ready</Text>;

            }

            const { stdin, unmount } = render(
                <TestWrapper>
                    <InputCapture />
                </TestWrapper>,
            );

            // Wait for focus to be established
            await new Promise((resolve) => setTimeout(resolve, 20));

            stdin.write('a');

            // Wait for handler
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(receivedInput).toBe('a');
            expect(receivedKey).toBeDefined();

            unmount();

        });

    });

    describe('useListKeys', () => {

        it('should start at initialIndex', () => {

            function ListComponent() {

                const { isFocused } = useFocusScope('test');
                const items = ['a', 'b', 'c'];

                const { selectedIndex } = useListKeys({
                    items,
                    isFocused,
                    initialIndex: 1,
                });

                return <Text>selected:{selectedIndex}</Text>;

            }

            const { lastFrame, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('selected:1');

            unmount();

        });

        it('should navigate down with arrow key', async () => {

            function ListComponent() {

                const { isFocused } = useFocusScope('test');
                const items = ['a', 'b', 'c'];

                const { selectedIndex } = useListKeys({
                    items,
                    isFocused,
                });

                return <Text>selected:{selectedIndex}</Text>;

            }

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            // Wait for focus to be established
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(lastFrame()).toContain('selected:0');

            stdin.write(KEYS.DOWN);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('selected:1');

            stdin.write(KEYS.DOWN);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('selected:2');

            unmount();

        });

        it('should navigate up with arrow key', async () => {

            function ListComponent() {

                const { isFocused } = useFocusScope('test');
                const items = ['a', 'b', 'c'];

                const { selectedIndex } = useListKeys({
                    items,
                    isFocused,
                    initialIndex: 2,
                });

                return <Text>selected:{selectedIndex}</Text>;

            }

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            // Wait for focus to be established
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(lastFrame()).toContain('selected:2');

            stdin.write(KEYS.UP);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('selected:1');

            stdin.write(KEYS.UP);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('selected:0');

            unmount();

        });

        it('should wrap from end to beginning', async () => {

            function ListComponent() {

                const { isFocused } = useFocusScope('test');
                const items = ['a', 'b', 'c'];

                const { selectedIndex } = useListKeys({
                    items,
                    isFocused,
                    initialIndex: 2,
                });

                return <Text>selected:{selectedIndex}</Text>;

            }

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            // Wait for focus to be established
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(lastFrame()).toContain('selected:2');

            stdin.write(KEYS.DOWN);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('selected:0');

            unmount();

        });

        it('should wrap from beginning to end', async () => {

            function ListComponent() {

                const { isFocused } = useFocusScope('test');
                const items = ['a', 'b', 'c'];

                const { selectedIndex } = useListKeys({
                    items,
                    isFocused,
                    initialIndex: 0,
                });

                return <Text>selected:{selectedIndex}</Text>;

            }

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            // Wait for focus to be established
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(lastFrame()).toContain('selected:0');

            stdin.write(KEYS.UP);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('selected:2');

            unmount();

        });

        it('should call onSelect when Enter is pressed', async () => {

            const onSelect = vi.fn();

            function ListComponent() {

                const { isFocused } = useFocusScope('test');
                const items = ['apple', 'banana', 'cherry'];

                const { selectedIndex } = useListKeys({
                    items,
                    isFocused,
                    onSelect,
                    initialIndex: 1,
                });

                return <Text>selected:{selectedIndex}</Text>;

            }

            const { stdin, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            // Wait for focus to be established
            await new Promise((resolve) => setTimeout(resolve, 20));

            stdin.write(KEYS.ENTER);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(onSelect).toHaveBeenCalledWith('banana', 1);

            unmount();

        });

        it('should handle empty items array', () => {

            function ListComponent() {

                const { isFocused } = useFocusScope('test');
                const items: string[] = [];

                const { selectedIndex } = useListKeys({
                    items,
                    isFocused,
                });

                return <Text>selected:{selectedIndex}</Text>;

            }

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('selected:0');

            // Should not crash on navigation
            stdin.write(KEYS.DOWN);
            stdin.write(KEYS.UP);

            expect(lastFrame()).toContain('selected:0');

            unmount();

        });

        it('should expose selectPrevious and selectNext functions', () => {

            function ListComponent() {

                const { isFocused } = useFocusScope('test');
                const items = ['a', 'b', 'c'];

                const { selectedIndex, selectNext, selectPrevious } = useListKeys({
                    items,
                    isFocused,
                });

                return (
                    <Text>
                        selected:{selectedIndex}|hasNext:
                        {typeof selectNext === 'function' ? 'yes' : 'no'}|hasPrev:
                        {typeof selectPrevious === 'function' ? 'yes' : 'no'}
                    </Text>
                );

            }

            const { lastFrame, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('hasNext:yes');
            expect(lastFrame()).toContain('hasPrev:yes');

            unmount();

        });

        it('should allow manual setSelectedIndex', { retry: 2 }, async () => {

            function ListComponent() {

                const { isFocused } = useFocusScope('test');
                const items = ['a', 'b', 'c', 'd', 'e'];
                const [jumped, setJumped] = useState(false);

                const { selectedIndex, setSelectedIndex } = useListKeys({
                    items,
                    isFocused,
                });

                const handleJump = useCallback(() => {

                    setSelectedIndex(4);
                    setJumped(true);

                }, [setSelectedIndex]);

                // Jump on first 'j' keypress
                useFocusedInput(isFocused, (input) => {

                    if (input === 'j' && !jumped) {

                        handleJump();

                    }

                });

                return <Text>selected:{selectedIndex}</Text>;

            }

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            // Wait for focus to be established
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(lastFrame()).toContain('selected:0');

            stdin.write('j');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('selected:4');

            unmount();

        });

        it('should not respond to keys when not focused', () => {

            function ListComponent() {

                const items = ['a', 'b', 'c'];

                const { selectedIndex } = useListKeys({
                    items,
                    isFocused: false,
                });

                return <Text>selected:{selectedIndex}</Text>;

            }

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ListComponent />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('selected:0');

            stdin.write(KEYS.DOWN);

            // Should still be 0 since not focused
            expect(lastFrame()).toContain('selected:0');

            unmount();

        });

    });

    describe('useQuitHandler', () => {

        it('should return handleQuit function', () => {

            function QuitComponent() {

                const { handleQuit } = useQuitHandler();

                return <Text>hasQuit:{typeof handleQuit === 'function' ? 'yes' : 'no'}</Text>;

            }

            const { lastFrame, unmount } = render(
                <TestWrapper>
                    <QuitComponent />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('hasQuit:yes');

            unmount();

        });

    });

});
