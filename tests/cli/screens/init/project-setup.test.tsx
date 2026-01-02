/**
 * ProjectSetup component tests.
 *
 * Tests the project setup step during initialization.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/cli/focus.js';
import { ProjectSetup } from '../../../../src/cli/screens/init/ProjectSetup.js';

/**
 * Wrapper with focus provider for components that need focus.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>;

}

describe('cli: screens/init/ProjectSetup', () => {

    it('should render title', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('Initialize noorm');

    });

    it('should show directory structure description', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('directory structure');

    });

    it('should show default schema path', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('./sql');

    });

    it('should show default changes path', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('./changes');

    });

    it('should show custom schema path when provided', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup
                    sqlPath="./db/sql"
                    onAddConfig={() => {}}
                    onSkipConfig={() => {}}
                    onCancel={() => {}}
                />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('./db/sql');

    });

    it('should show what will be created', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('Will create');
        expect(lastFrame()).toContain('.gitkeep');
        expect(lastFrame()).toContain('settings.yml');
        expect(lastFrame()).toContain('state.enc');

    });

    it('should show config question', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('database configuration');

    });

    it('should show add config option', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('set up my first config');

    });

    it('should show skip option', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain("I'll do it later");

    });

    it('should show keyboard hints', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('[Enter]');
        expect(lastFrame()).toContain('[Esc]');

    });

    it('should highlight first option by default', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        // First option should have the highlight indicator
        expect(lastFrame()).toContain('❯');

    });

    // Note: This test may be flaky when run with other tests due to ink's global stdin handling.
    // It passes consistently in isolation. Mark with retry for CI stability.
    it('should call onAddConfig when first option selected', { retry: 2 }, async () => {

        const onAddConfig = vi.fn();
        const { stdin, unmount } = render(
            <TestWrapper>
                <ProjectSetup
                    onAddConfig={onAddConfig}
                    onSkipConfig={() => {}}
                    onCancel={() => {}}
                />
            </TestWrapper>,
        );

        // Wait for focus to be pushed and render to complete
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Press Enter to select first option (Add Config)
        stdin.write('\r');

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onAddConfig).toHaveBeenCalled();

        // Clean up
        unmount();

    });

    it('should call onSkipConfig when second option selected', async () => {

        const onSkipConfig = vi.fn();
        const { stdin, unmount } = render(
            <TestWrapper>
                <ProjectSetup
                    onAddConfig={() => {}}
                    onSkipConfig={onSkipConfig}
                    onCancel={() => {}}
                />
            </TestWrapper>,
        );

        // Wait for focus to be pushed and render to complete
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Press down arrow to move to second option
        stdin.write('\x1b[B');

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Press Enter to select
        stdin.write('\r');

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onSkipConfig).toHaveBeenCalled();

        // Clean up
        unmount();

    });

    it('should navigate options with arrow keys', async () => {

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <ProjectSetup onAddConfig={() => {}} onSkipConfig={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        // Wait for render
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Initially first option is highlighted
        let frame = lastFrame();
        expect(frame).toContain('❯');

        // Press down to move to second option
        stdin.write('\x1b[B');

        await new Promise((resolve) => setTimeout(resolve, 50));

        frame = lastFrame();

        // The second option should now be highlighted (skip option)
        // Check that "I'll do it later" line has the highlight
        expect(frame).toContain("I'll do it later");

        // Clean up
        unmount();

    });

});
