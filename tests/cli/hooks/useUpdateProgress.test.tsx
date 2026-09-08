/**
 * useUpdateProgress hook tests.
 *
 * Tests event handlers for update download progress tracking.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { Text, Box } from 'ink';

import { observer } from '../../../src/core/observer.js';
import { NoormObserver } from '../../../src/tui/observer-context.js';
import { useUpdateProgress } from '../../../src/tui/hooks/useUpdateProgress.js';

/**
 * Test component that renders update progress state.
 */
function UpdateProgressView() {

    const { state } = useUpdateProgress();

    return (
        <Box flexDirection="column">
            <Text>phase:{state.phase}</Text>
            <Text>received:{state.received}</Text>
            <Text>total:{state.total}</Text>
            <Text>retry:{state.retry ? `${state.retry.attempt}/${state.retry.maxAttempts}:${state.retry.error}` : 'none'}</Text>
        </Box>
    );

}

/**
 * Wrap component with NoormObserver provider for testing.
 */
function WithProvider({ children }: { children: React.ReactNode }) {

    return <NoormObserver>{children}</NoormObserver>;

}

describe('cli: hooks/useUpdateProgress', () => {

    it('should update received/total on update:progress', async () => {

        const { lastFrame, unmount } = render(<WithProvider><UpdateProgressView /></WithProvider>);

        await new Promise((r) => setTimeout(r, 50));

        observer.emit('update:installing', { version: '1.2.3' });
        await new Promise((r) => setTimeout(r, 50));

        expect(lastFrame()).toContain('phase:downloading');

        observer.emit('update:progress', { version: '1.2.3', received: 512000, total: 2048000 });
        await new Promise((r) => setTimeout(r, 50));

        expect(lastFrame()).toContain('received:512000');
        expect(lastFrame()).toContain('total:2048000');

        unmount();

    });

    it('should reset counters on a fresh update:installing after a prior run', async () => {

        const { lastFrame, unmount } = render(<WithProvider><UpdateProgressView /></WithProvider>);

        await new Promise((r) => setTimeout(r, 50));

        observer.emit('update:installing', { version: '1.2.3' });
        await new Promise((r) => setTimeout(r, 50));

        observer.emit('update:progress', { version: '1.2.3', received: 1500000, total: 2048000 });
        await new Promise((r) => setTimeout(r, 50));

        expect(lastFrame()).toContain('received:1500000');

        // Second install in the same session should not start at the previous percentage
        observer.emit('update:installing', { version: '1.3.0' });
        await new Promise((r) => setTimeout(r, 50));

        expect(lastFrame()).toContain('received:0');
        expect(lastFrame()).toContain('total:0');
        expect(lastFrame()).toContain('phase:downloading');

        unmount();

    });

    it('should record a retry without zeroing received', async () => {

        const { lastFrame, unmount } = render(<WithProvider><UpdateProgressView /></WithProvider>);

        await new Promise((r) => setTimeout(r, 50));

        observer.emit('update:installing', { version: '1.2.3' });
        await new Promise((r) => setTimeout(r, 50));

        observer.emit('update:progress', { version: '1.2.3', received: 800000, total: 2048000 });
        await new Promise((r) => setTimeout(r, 50));

        observer.emit('update:retry', { version: '1.2.3', attempt: 0, maxAttempts: 3, error: 'stalled' });
        await new Promise((r) => setTimeout(r, 50));

        expect(lastFrame()).toContain('retry:0/3:stalled');
        expect(lastFrame()).toContain('received:800000');

        unmount();

    });

    it('should set phase to complete on update:complete', async () => {

        const { lastFrame, unmount } = render(<WithProvider><UpdateProgressView /></WithProvider>);

        await new Promise((r) => setTimeout(r, 50));

        observer.emit('update:installing', { version: '1.2.3' });
        await new Promise((r) => setTimeout(r, 50));

        observer.emit('update:complete', { previousVersion: '1.2.0', newVersion: '1.2.3' });
        await new Promise((r) => setTimeout(r, 50));

        expect(lastFrame()).toContain('phase:complete');

        unmount();

    });

});
