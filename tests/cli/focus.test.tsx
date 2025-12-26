/**
 * Focus stack tests.
 *
 * Tests FocusProvider and focus management hooks.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import React, { useEffect, useState } from 'react'
import { Text } from 'ink'

import {
    FocusProvider,
    useFocusContext,
    useFocusScope,
    useIsFocused,
    useActiveFocus,
} from '../../src/cli/focus.js'


/**
 * Test component that displays focus stack state.
 */
function FocusDisplay() {

    const { activeId, stack } = useFocusContext()

    return (
        <Text>
            activeId:{activeId ?? 'null'}|stackLen:{stack.length}|stackIds:{stack.map(e => e.id).join(',')}
        </Text>
    )
}


/**
 * Test component that pushes focus on mount.
 */
function PushOnMount({ id, label }: { id: string; label?: string }) {

    const { push } = useFocusContext()

    useEffect(() => {

        push(id, label)
    }, [push, id, label])

    return <FocusDisplay />
}


/**
 * Test component that pushes then pops focus.
 */
function PushThenPop({ id }: { id: string }) {

    const { push, pop } = useFocusContext()
    const [step, setStep] = useState(0)

    useEffect(() => {

        if (step === 0) {

            push(id)
            setStep(1)
        }
        else if (step === 1) {

            pop(id)
            setStep(2)
        }
    }, [step, push, pop, id])

    return <FocusDisplay />
}


describe('cli: focus', () => {

    describe('FocusProvider', () => {

        it('should provide empty focus stack initially', () => {

            const { lastFrame } = render(
                <FocusProvider>
                    <FocusDisplay />
                </FocusProvider>
            )

            expect(lastFrame()).toContain('activeId:null')
            expect(lastFrame()).toContain('stackLen:0')
        })
    })

    describe('useFocusContext', () => {

        it('should throw when used outside FocusProvider', () => {

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

            // In React 19, errors during render are caught and logged
            // Check that the render fails with an error frame
            const { lastFrame } = render(<FocusDisplay />)
            const output = lastFrame() ?? ''

            expect(output).toContain('useFocusContext must be used within a FocusProvider')

            errorSpy.mockRestore()
        })
    })

    describe('push', () => {

        it('should add entry to focus stack', async () => {

            const { lastFrame } = render(
                <FocusProvider>
                    <PushOnMount id="test-1" />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 10))

            expect(lastFrame()).toContain('activeId:test-1')
            expect(lastFrame()).toContain('stackLen:1')
        })

        it('should make pushed entry the active one', async () => {

            function PushTwo() {

                const { push } = useFocusContext()
                const [step, setStep] = useState(0)

                useEffect(() => {

                    if (step === 0) {

                        push('first')
                        setStep(1)
                    }
                    else if (step === 1) {

                        push('second')
                        setStep(2)
                    }
                }, [step, push])

                return <FocusDisplay />
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <PushTwo />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('activeId:second')
            expect(lastFrame()).toContain('stackLen:2')
            expect(lastFrame()).toContain('stackIds:first,second')
        })

        it('should not add duplicate IDs', async () => {

            function PushDuplicate() {

                const { push } = useFocusContext()
                const [step, setStep] = useState(0)

                useEffect(() => {

                    if (step === 0) {

                        push('same-id')
                        setStep(1)
                    }
                    else if (step === 1) {

                        push('same-id')  // Duplicate
                        setStep(2)
                    }
                }, [step, push])

                return <FocusDisplay />
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <PushDuplicate />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('stackLen:1')
        })

        it('should store label with entry', async () => {

            function DisplayLabel() {

                const { stack } = useFocusContext()

                return (
                    <Text>
                        labels:{stack.map(e => e.label ?? 'none').join(',')}
                    </Text>
                )
            }

            function PushWithLabel() {

                const { push } = useFocusContext()

                useEffect(() => {

                    push('my-id', 'My Label')
                }, [push])

                return <DisplayLabel />
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <PushWithLabel />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 10))

            expect(lastFrame()).toContain('labels:My Label')
        })
    })

    describe('pop', () => {

        it('should remove entry from focus stack', async () => {

            const { lastFrame } = render(
                <FocusProvider>
                    <PushThenPop id="test-1" />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('activeId:null')
            expect(lastFrame()).toContain('stackLen:0')
        })

        it('should do nothing if ID not in stack', async () => {

            function PopNonExistent() {

                const { push, pop } = useFocusContext()
                const [step, setStep] = useState(0)

                useEffect(() => {

                    if (step === 0) {

                        push('existing')
                        setStep(1)
                    }
                    else if (step === 1) {

                        pop('non-existent')
                        setStep(2)
                    }
                }, [step, push, pop])

                return <FocusDisplay />
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <PopNonExistent />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 50))

            expect(lastFrame()).toContain('stackLen:1')
            expect(lastFrame()).toContain('activeId:existing')
        })

        it('should allow popping from middle of stack', async () => {

            function PopMiddle() {

                const { push, pop } = useFocusContext()
                const [step, setStep] = useState(0)

                useEffect(() => {

                    if (step === 0) {

                        push('first')
                        setStep(1)
                    }
                    else if (step === 1) {

                        push('second')
                        setStep(2)
                    }
                    else if (step === 2) {

                        push('third')
                        setStep(3)
                    }
                    else if (step === 3) {

                        pop('second')  // Pop middle
                        setStep(4)
                    }
                }, [step, push, pop])

                return <FocusDisplay />
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <PopMiddle />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 100))

            expect(lastFrame()).toContain('stackLen:2')
            expect(lastFrame()).toContain('stackIds:first,third')
            expect(lastFrame()).toContain('activeId:third')
        })
    })

    describe('isActive', () => {

        it('should return true for top of stack', async () => {

            function CheckActive() {

                const { push, isActive } = useFocusContext()
                const [active, setActive] = useState<boolean | null>(null)

                useEffect(() => {

                    push('test-id')
                    setActive(isActive('test-id'))
                }, [push, isActive])

                return <Text>isActive:{String(active)}</Text>
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <CheckActive />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 10))

            expect(lastFrame()).toContain('isActive:true')
        })

        it('should return false for non-top entries', async () => {

            function CheckNotActive() {

                const { push, isActive } = useFocusContext()
                const [active, setActive] = useState<boolean | null>(null)

                useEffect(() => {

                    push('first')
                    push('second')
                    setActive(isActive('first'))
                }, [push, isActive])

                return <Text>isActive:{String(active)}</Text>
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <CheckNotActive />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 10))

            expect(lastFrame()).toContain('isActive:false')
        })

        it('should return false for empty stack', () => {

            function CheckEmpty() {

                const { isActive } = useFocusContext()
                const active = isActive('any-id')

                return <Text>isActive:{String(active)}</Text>
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <CheckEmpty />
                </FocusProvider>
            )

            expect(lastFrame()).toContain('isActive:false')
        })
    })

    describe('useFocusScope', () => {

        it('should auto-push on mount and pop on unmount', { retry: 2 }, async () => {

            function FocusScopeUser() {

                const { isFocused, focusId } = useFocusScope('test-scope')

                return <Text>focused:{String(isFocused)}|id:{focusId}</Text>
            }

            function Wrapper() {

                const [show, setShow] = useState(true)
                const { stack } = useFocusContext()

                useEffect(() => {

                    const timer = setTimeout(() => setShow(false), 100)
                    return () => clearTimeout(timer)
                }, [])

                return (
                    <>
                        {show && <FocusScopeUser />}
                        <Text>stackLen:{stack.length}</Text>
                    </>
                )
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <Wrapper />
                </FocusProvider>
            )

            // Initially mounted - wait for focus stack to initialize
            await new Promise(resolve => setTimeout(resolve, 50))
            expect(lastFrame()).toContain('focused:true')
            expect(lastFrame()).toContain('stackLen:1')

            // After unmount
            await new Promise(resolve => setTimeout(resolve, 100))
            expect(lastFrame()).toContain('stackLen:0')
        })

        it('should return stable focusId', async () => {

            function IdCollector({ onId }: { onId: (id: string) => void }) {

                const { focusId } = useFocusScope()

                useEffect(() => {

                    onId(focusId)
                }, [focusId, onId])

                return <Text>id:{focusId}</Text>
            }

            const ids: string[] = []
            const { rerender } = render(
                <FocusProvider>
                    <IdCollector onId={(id) => ids.push(id)} />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 10))

            // Rerender should keep same ID
            rerender(
                <FocusProvider>
                    <IdCollector onId={(id) => ids.push(id)} />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 10))

            // All collected IDs should be the same
            expect(ids.length).toBeGreaterThan(0)
            expect(new Set(ids).size).toBe(1)
        })
    })

    describe('useIsFocused', () => {

        it('should return focus state for specific ID', async () => {

            function CheckFocus() {

                const { push } = useFocusContext()
                const isFocused = useIsFocused('target')

                useEffect(() => {

                    push('target')
                }, [push])

                return <Text>focused:{String(isFocused)}</Text>
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <CheckFocus />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 10))

            expect(lastFrame()).toContain('focused:true')
        })
    })

    describe('useActiveFocus', () => {

        it('should return null when stack is empty', () => {

            function ActiveDisplay() {

                const activeId = useActiveFocus()

                return <Text>active:{activeId ?? 'null'}</Text>
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <ActiveDisplay />
                </FocusProvider>
            )

            expect(lastFrame()).toContain('active:null')
        })

        it('should return current active ID', async () => {

            function ActiveDisplay() {

                const { push } = useFocusContext()
                const activeId = useActiveFocus()

                useEffect(() => {

                    push('my-active')
                }, [push])

                return <Text>active:{activeId ?? 'null'}</Text>
            }

            const { lastFrame } = render(
                <FocusProvider>
                    <ActiveDisplay />
                </FocusProvider>
            )

            await new Promise(resolve => setTimeout(resolve, 10))

            expect(lastFrame()).toContain('active:my-active')
        })
    })
})
