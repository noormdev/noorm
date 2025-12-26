/**
 * List components tests.
 *
 * Tests SelectList, ActionList, and StatusList components.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'

import { FocusProvider } from '../../../src/cli/focus.js'
import {
    SelectList,
    ActionList,
    StatusList,
} from '../../../src/cli/components/lists/index.js'


/**
 * Wrapper with focus provider for components that need focus.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>
}


describe('cli: components/lists', () => {

    describe('SelectList', () => {

        it('should render items', () => {

            const items = [
                { key: '1', label: 'Item 1', value: 'one' },
                { key: '2', label: 'Item 2', value: 'two' },
            ]

            const { lastFrame } = render(
                <TestWrapper>
                    <SelectList items={items} />
                </TestWrapper>
            )

            expect(lastFrame()).toContain('Item 1')
            expect(lastFrame()).toContain('Item 2')
        })

        it('should show empty label when no items', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <SelectList items={[]} emptyLabel="No configs found" />
                </TestWrapper>
            )

            expect(lastFrame()).toContain('No configs found')
        })

        it('should filter out disabled items from select', () => {

            const items = [
                { key: '1', label: 'Enabled', value: 'one' },
                { key: '2', label: 'Disabled', value: 'two', disabled: true },
            ]

            const { lastFrame } = render(
                <TestWrapper>
                    <SelectList items={items} />
                </TestWrapper>
            )

            expect(lastFrame()).toContain('Enabled')
            expect(lastFrame()).not.toContain('Disabled')
        })

        it('should render items with icons', () => {

            const items = [
                { key: '1', label: 'Config', value: 'one', icon: '⚙️' },
            ]

            const { lastFrame } = render(
                <TestWrapper>
                    <SelectList items={items} />
                </TestWrapper>
            )

            expect(lastFrame()).toContain('⚙️')
            expect(lastFrame()).toContain('Config')
        })
    })

    describe('ActionList', () => {

        it('should render actions with keys', () => {

            const actions = [
                { key: 'a', label: 'Add' },
                { key: 'e', label: 'Edit' },
            ]

            const { lastFrame } = render(<ActionList actions={actions} />)

            expect(lastFrame()).toContain('[a]')
            expect(lastFrame()).toContain('Add')
            expect(lastFrame()).toContain('[e]')
            expect(lastFrame()).toContain('Edit')
        })

        it('should hide disabled actions', () => {

            const actions = [
                { key: 'a', label: 'Add' },
                { key: 'd', label: 'Delete', disabled: true },
            ]

            const { lastFrame } = render(<ActionList actions={actions} />)

            expect(lastFrame()).toContain('Add')
            expect(lastFrame()).not.toContain('Delete')
        })

        it('should render in column direction', () => {

            const actions = [
                { key: 'a', label: 'Add' },
                { key: 'e', label: 'Edit' },
            ]

            const { lastFrame } = render(
                <ActionList actions={actions} direction="column" />
            )

            expect(lastFrame()).toContain('Add')
            expect(lastFrame()).toContain('Edit')
        })
    })

    describe('StatusList', () => {

        it('should render items with status icons', () => {

            const items = [
                { label: 'file1.sql', status: 'success' as const },
                { label: 'file2.sql', status: 'error' as const },
            ]

            const { lastFrame } = render(<StatusList items={items} />)

            expect(lastFrame()).toContain('file1.sql')
            expect(lastFrame()).toContain('file2.sql')
            expect(lastFrame()).toContain('✓')  // Success icon
            expect(lastFrame()).toContain('✗')  // Error icon
        })

        it('should show detail text', () => {

            const items = [
                { label: 'file.sql', status: 'error' as const, detail: 'Syntax error' },
            ]

            const { lastFrame } = render(<StatusList items={items} />)

            expect(lastFrame()).toContain('Syntax error')
        })

        it('should limit visible items', () => {

            const items = [
                { label: 'file1.sql', status: 'success' as const },
                { label: 'file2.sql', status: 'success' as const },
                { label: 'file3.sql', status: 'success' as const },
                { label: 'file4.sql', status: 'success' as const },
            ]

            const { lastFrame } = render(
                <StatusList items={items} maxVisible={2} />
            )

            // Should show last 2 items and hidden count
            expect(lastFrame()).toContain('file3.sql')
            expect(lastFrame()).toContain('file4.sql')
            expect(lastFrame()).toContain('2 more')
        })

        it('should hide icons when showIcons is false', () => {

            const items = [
                { label: 'file.sql', status: 'success' as const },
            ]

            const { lastFrame } = render(
                <StatusList items={items} showIcons={false} />
            )

            expect(lastFrame()).toContain('file.sql')
            expect(lastFrame()).not.toContain('✓')
        })

        it('should render all status types', () => {

            const items = [
                { label: 'pending', status: 'pending' as const },
                { label: 'running', status: 'running' as const },
                { label: 'success', status: 'success' as const },
                { label: 'error', status: 'error' as const },
                { label: 'warning', status: 'warning' as const },
                { label: 'skipped', status: 'skipped' as const },
            ]

            const { lastFrame } = render(<StatusList items={items} />)

            expect(lastFrame()).toContain('pending')
            expect(lastFrame()).toContain('running')
            expect(lastFrame()).toContain('success')
            expect(lastFrame()).toContain('error')
            expect(lastFrame()).toContain('warning')
            expect(lastFrame()).toContain('skipped')
        })
    })
})
