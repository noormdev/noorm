/**
 * Dialog components tests.
 *
 * Tests Confirm, ProtectedConfirm, and FilePicker components.
 */
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/cli/focus.js';
import {
    Confirm,
    ProtectedConfirm,
    FilePicker,
} from '../../../src/cli/components/dialogs/index.js';

/**
 * Wrapper with focus provider for components that need focus.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>;

}

describe('cli: components/dialogs', () => {

    describe('Confirm', () => {

        it('should render message', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Confirm
                        message="Delete this config?"
                        onConfirm={() => {}}
                        onCancel={() => {}}
                    />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('Delete this config?');

        });

        it('should render title', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Confirm
                        title="Confirm Delete"
                        message="Are you sure?"
                        onConfirm={() => {}}
                        onCancel={() => {}}
                    />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('Confirm Delete');

        });

        it('should render Y/n prompt', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Confirm message="Proceed?" onConfirm={() => {}} onCancel={() => {}} />
                </TestWrapper>,
            );

            // ConfirmInput shows Y/n
            const frame = lastFrame() ?? '';
            expect(frame.toLowerCase()).toMatch(/y.*n|n.*y/);

        });

    });

    describe('ProtectedConfirm', () => {

        it('should render config name', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <ProtectedConfirm
                        configName="production"
                        action="delete"
                        onConfirm={() => {}}
                        onCancel={() => {}}
                    />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('production');

        });

        it('should show action being performed', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <ProtectedConfirm
                        configName="production"
                        action="destroy"
                        onConfirm={() => {}}
                        onCancel={() => {}}
                    />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('destroy');

        });

        it('should show confirmation phrase', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <ProtectedConfirm
                        configName="production"
                        action="delete"
                        onConfirm={() => {}}
                        onCancel={() => {}}
                    />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('yes-production');

        });

        it('should render protected configuration title', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <ProtectedConfirm
                        configName="prod"
                        action="delete"
                        onConfirm={() => {}}
                        onCancel={() => {}}
                    />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('Protected Configuration');

        });

    });

    describe('FilePicker', () => {

        it('should render file list', () => {

            const files = ['schema/001_users.sql', 'schema/002_posts.sql'];

            const { lastFrame } = render(
                <TestWrapper>
                    <FilePicker files={files} onSelect={() => {}} onCancel={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('001_users.sql');
            expect(lastFrame()).toContain('002_posts.sql');

        });

        it('should show file count', () => {

            const files = ['file1.sql', 'file2.sql', 'file3.sql'];

            const { lastFrame } = render(
                <TestWrapper>
                    <FilePicker files={files} onSelect={() => {}} onCancel={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('3 files');

        });

        it('should show selected count', () => {

            const files = ['file1.sql', 'file2.sql'];
            const selected = ['file1.sql'];

            const { lastFrame } = render(
                <TestWrapper>
                    <FilePicker
                        files={files}
                        selected={selected}
                        onSelect={() => {}}
                        onCancel={() => {}}
                    />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('1 selected');

        });

        it('should show mode indicator', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <FilePicker files={['file.sql']} onSelect={() => {}} onCancel={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('Search Mode');

        });

        it('should show search input', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <FilePicker files={['file.sql']} onSelect={() => {}} onCancel={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('Search:');

        });

        it('should show keyboard shortcuts', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <FilePicker files={['file.sql']} onSelect={() => {}} onCancel={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('[Tab]');
            expect(lastFrame()).toContain('[Esc]');

        });

        it('should show no match message when filter returns empty', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <FilePicker files={[]} onSelect={() => {}} onCancel={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('No files');

        });

        it('should mark selected files with checkbox', () => {

            const files = ['file1.sql', 'file2.sql'];
            const selected = ['file1.sql'];

            const { lastFrame } = render(
                <TestWrapper>
                    <FilePicker
                        files={files}
                        selected={selected}
                        onSelect={() => {}}
                        onCancel={() => {}}
                    />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('☑'); // Selected
            expect(lastFrame()).toContain('☐'); // Not selected

        });

    });

});
