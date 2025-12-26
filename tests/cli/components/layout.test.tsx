/**
 * Layout components tests.
 *
 * Tests Panel and Divider components.
 */
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { Text } from 'ink'

import { Panel, Divider } from '../../../src/cli/components/layout/index.js'


describe('cli: components/layout', () => {

    describe('Panel', () => {

        it('should render children', () => {

            const { lastFrame } = render(
                <Panel>
                    <Text>Panel content</Text>
                </Panel>
            )

            expect(lastFrame()).toContain('Panel content')
        })

        it('should render title when provided', () => {

            const { lastFrame } = render(
                <Panel title="My Panel">
                    <Text>Content</Text>
                </Panel>
            )

            expect(lastFrame()).toContain('My Panel')
            expect(lastFrame()).toContain('Content')
        })

        it('should apply border style', () => {

            const { lastFrame } = render(
                <Panel borderStyle="round">
                    <Text>Content</Text>
                </Panel>
            )

            // Round border uses curved characters
            expect(lastFrame()).toContain('╭')
            expect(lastFrame()).toContain('╰')
        })

        it('should render without title', () => {

            const { lastFrame } = render(
                <Panel>
                    <Text>Just content</Text>
                </Panel>
            )

            expect(lastFrame()).toContain('Just content')
        })
    })

    describe('Divider', () => {

        it('should render horizontal line', () => {

            const { lastFrame } = render(<Divider />)

            expect(lastFrame()).toContain('─')
        })

        it('should render with label', () => {

            const { lastFrame } = render(<Divider label="Actions" />)

            expect(lastFrame()).toContain('Actions')
            expect(lastFrame()).toContain('─')
        })

        it('should use custom character', () => {

            const { lastFrame } = render(<Divider char="=" width={20} />)

            expect(lastFrame()).toContain('=')
        })

        it('should center label between lines', () => {

            const { lastFrame } = render(<Divider label="Test" width={20} />)

            // Label should be surrounded by divider characters
            const frame = lastFrame() ?? ''
            const testIndex = frame.indexOf('Test')
            expect(testIndex).toBeGreaterThan(0)
        })
    })
})
