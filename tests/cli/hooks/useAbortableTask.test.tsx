/**
 * useAbortableTask tests.
 *
 * The intent: a result that arrives after its operation was cancelled or
 * replaced must be recognisable as stale. That is the difference between an
 * escape hatch and a screen that silently un-cancels itself a minute later.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import React from 'react';

import { useAbortableTask, type AbortableTask } from '../../../src/tui/hooks/useAbortableTask.js';

/**
 * Hands the hook's handle out to the test, since ink-testing-library renders
 * components rather than hooks.
 */
function Probe({ onReady }: { onReady: (task: AbortableTask) => void }) {

    const task = useAbortableTask();

    onReady(task);

    return <Text>probe</Text>;

}

/**
 * Render the probe and return the live handle plus the unmount function.
 */
function mountTask() {

    const captured: AbortableTask[] = [];

    const { unmount } = render(<Probe onReady={(t) => captured.push(t)} />);

    const task = captured[0];

    if (!task) throw new Error('probe did not render');

    return { task, unmount };

}

describe('cli: useAbortableTask', () => {

    it('should treat a freshly started operation as current', () => {

        const { task, unmount } = mountTask();

        const controller = task.start();

        expect(task.isCurrent(controller)).toBe(true);
        expect(controller.signal.aborted).toBe(false);

        unmount();

    });

    it('should abort the live operation and report that it did', () => {

        const { task, unmount } = mountTask();

        const controller = task.start();

        expect(task.cancel()).toBe(true);
        expect(controller.signal.aborted).toBe(true);

        unmount();

    });

    it('should report nothing to cancel when no operation is running', () => {

        const { task, unmount } = mountTask();

        expect(task.cancel()).toBe(false);

        unmount();

    });

    it('should report nothing to cancel twice for one operation', () => {

        const { task, unmount } = mountTask();

        task.start();

        expect(task.cancel()).toBe(true);
        expect(task.cancel()).toBe(false);

        unmount();

    });

    it('should stop treating a cancelled operation as current, even though it is still the latest', () => {

        const { task, unmount } = mountTask();

        const controller = task.start();
        task.cancel();

        // The driver is free to answer anyway. This is the check that keeps
        // that answer off the screen.
        expect(task.isCurrent(controller)).toBe(false);

        unmount();

    });

    it('should stop treating a superseded operation as current', () => {

        const { task, unmount } = mountTask();

        const first = task.start();
        const second = task.start();

        expect(task.isCurrent(first)).toBe(false);
        expect(task.isCurrent(second)).toBe(true);

        unmount();

    });

    it('should not treat a controller it never issued as current', () => {

        const { task, unmount } = mountTask();

        task.start();

        // Identity, not just liveness: a live controller from somewhere else is
        // not this screen's operation, and answering to it would let one
        // screen's result write over another's.
        expect(task.isCurrent(new AbortController())).toBe(false);

        unmount();

    });

    it('should abort the operation it replaces, so the abandoned work is released', () => {

        const { task, unmount } = mountTask();

        const first = task.start();
        task.start();

        expect(first.signal.aborted).toBe(true);

        unmount();

    });

    it('should abort on unmount rather than leaving the operation running', () => {

        const { task, unmount } = mountTask();

        const controller = task.start();

        unmount();

        expect(controller.signal.aborted).toBe(true);
        expect(task.isCurrent(controller)).toBe(false);

    });

});
