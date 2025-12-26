/**
 * Observer hooks tests.
 *
 * Tests useOnEvent, useOnceEvent, useEmit, and useEventPromise.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import React, { useEffect, useState } from 'react'
import { Text } from 'ink'

import { observer } from '../../../src/core/observer.js'
import {
    useOnEvent,
    useOnceEvent,
    useEmit,
    useEventPromise
} from '../../../src/cli/hooks/useObserver.js'


describe('cli: hooks/useObserver', () => {

    describe('useOnEvent', () => {

        it('should subscribe to events and receive data', async () => {

            function Subscriber() {

                const [received, setReceived] = useState<string | null>(null)

                useOnEvent('config:created', (data) => {

                    setReceived(data.name)
                }, [])

                return <Text>received:{received ?? 'none'}</Text>
            }

            const { lastFrame } = render(<Subscriber />)

            expect(lastFrame()).toContain('received:none')

            await new Promise(r => setTimeout(r, 10))
            observer.emit('config:created', { name: 'test-config' })
            await new Promise(r => setTimeout(r, 10))

            expect(lastFrame()).toContain('received:test-config')
        })

        it('should receive multiple events', async () => {

            function Counter() {

                const [count, setCount] = useState(0)

                useOnEvent('config:created', () => {

                    setCount(c => c + 1)
                }, [])

                return <Text>count:{count}</Text>
            }

            const { lastFrame } = render(<Counter />)

            await new Promise(r => setTimeout(r, 10))

            observer.emit('config:created', { name: 'first' })
            observer.emit('config:created', { name: 'second' })
            observer.emit('config:created', { name: 'third' })

            await new Promise(r => setTimeout(r, 10))

            expect(lastFrame()).toContain('count:3')
        })

        it('should cleanup on unmount', async () => {

            let callCount = 0

            function Subscriber() {

                useOnEvent('config:created', () => {

                    callCount++
                }, [])

                return <Text>subscribed</Text>
            }

            const { unmount } = render(<Subscriber />)

            await new Promise(r => setTimeout(r, 10))

            observer.emit('config:created', { name: 'before-unmount' })
            await new Promise(r => setTimeout(r, 10))

            expect(callCount).toBe(1)

            unmount()

            observer.emit('config:created', { name: 'after-unmount' })
            await new Promise(r => setTimeout(r, 10))

            expect(callCount).toBe(1)
        })

        it('should use latest callback via ref', { retry: 2 }, async () => {

            function DynamicCallback() {

                const [prefix, setPrefix] = useState('A')
                const [received, setReceived] = useState<string>('')

                useOnEvent('config:created', (data) => {

                    setReceived(`${prefix}:${data.name}`)
                }, [prefix])

                useEffect(() => {

                    const timer = setTimeout(() => setPrefix('B'), 30)
                    return () => clearTimeout(timer)
                }, [])

                return <Text>received:{received}|prefix:{prefix}</Text>
            }

            const { lastFrame } = render(<DynamicCallback />)

            await new Promise(r => setTimeout(r, 10))

            observer.emit('config:created', { name: 'test' })
            await new Promise(r => setTimeout(r, 20))

            expect(lastFrame()).toContain('received:A:test')

            // Wait for prefix to change and effect to re-run
            await new Promise(r => setTimeout(r, 100))

            observer.emit('config:created', { name: 'test2' })
            await new Promise(r => setTimeout(r, 20))

            expect(lastFrame()).toContain('received:B:test2')
        })
    })

    describe('useOnceEvent', () => {

        it('should only receive first event', async () => {

            function OnceSubscriber() {

                const [received, setReceived] = useState<string[]>([])

                useOnceEvent('config:deleted', (data) => {

                    setReceived(prev => [...prev, data.name])
                }, [])

                return <Text>received:{received.join(',') || 'none'}</Text>
            }

            const { lastFrame } = render(<OnceSubscriber />)

            await new Promise(r => setTimeout(r, 10))

            observer.emit('config:deleted', { name: 'first' })
            observer.emit('config:deleted', { name: 'second' })
            observer.emit('config:deleted', { name: 'third' })

            await new Promise(r => setTimeout(r, 10))

            expect(lastFrame()).toContain('received:first')
            expect(lastFrame()).not.toContain('second')
        })

        it('should cleanup on unmount before event fires', async () => {

            let callCount = 0

            function OnceSubscriber() {

                useOnceEvent('config:deleted', () => {

                    callCount++
                }, [])

                return <Text>waiting</Text>
            }

            const { unmount } = render(<OnceSubscriber />)

            await new Promise(r => setTimeout(r, 10))

            unmount()

            observer.emit('config:deleted', { name: 'after-unmount' })
            await new Promise(r => setTimeout(r, 10))

            expect(callCount).toBe(0)
        })
    })

    describe('useEmit', () => {

        it('should return stable callback that emits events', async () => {

            let receivedData: { name: string } | null = null
            const cleanup = observer.on('config:created', (data) => {

                receivedData = data
            })

            function Emitter() {

                const emit = useEmit('config:created')

                useEffect(() => {

                    emit({ name: 'emitted-config' })
                }, [emit])

                return <Text>emitted</Text>
            }

            render(<Emitter />)

            await new Promise(r => setTimeout(r, 10))

            expect(receivedData).toEqual({ name: 'emitted-config' })

            cleanup()
        })

        it('should update callback when deps change', async () => {

            const received: string[] = []
            const cleanup = observer.on('config:created', (data) => {

                received.push(data.name)
            })

            function DynamicEmitter() {

                const [name, setName] = useState('first')
                const emit = useEmit('config:created', [name])

                useEffect(() => {

                    emit({ name })
                }, [emit, name])

                useEffect(() => {

                    const timer = setTimeout(() => setName('second'), 30)
                    return () => clearTimeout(timer)
                }, [])

                return <Text>name:{name}</Text>
            }

            render(<DynamicEmitter />)

            await new Promise(r => setTimeout(r, 100))

            expect(received).toContain('first')
            expect(received).toContain('second')

            cleanup()
        })
    })

    describe('useEventPromise', () => {

        it('should start in pending state', () => {

            function PromiseUser() {

                const [value, error, pending] = useEventPromise('build:complete')

                return (
                    <Text>
                        pending:{String(pending)}|value:{value ? 'yes' : 'no'}|error:{error ? 'yes' : 'no'}
                    </Text>
                )
            }

            const { lastFrame } = render(<PromiseUser />)

            expect(lastFrame()).toContain('pending:true')
            expect(lastFrame()).toContain('value:no')
            expect(lastFrame()).toContain('error:no')
        })

        it('should resolve with value when event fires', async () => {

            function PromiseUser() {

                const [value, error, pending] = useEventPromise('build:complete')

                return (
                    <Text>
                        pending:{String(pending)}|status:{value?.status ?? 'none'}
                    </Text>
                )
            }

            const { lastFrame } = render(<PromiseUser />)

            await new Promise(r => setTimeout(r, 10))

            observer.emit('build:complete', {
                status: 'success',
                filesRun: 5,
                filesSkipped: 2,
                filesFailed: 0,
                durationMs: 1234
            })

            await new Promise(r => setTimeout(r, 10))

            expect(lastFrame()).toContain('pending:false')
            expect(lastFrame()).toContain('status:success')
        })

        it('should allow cancellation', async () => {

            function CancellableUser() {

                const [value, error, pending, cancel] = useEventPromise('build:complete')

                useEffect(() => {

                    const timer = setTimeout(() => cancel(), 20)
                    return () => clearTimeout(timer)
                }, [cancel])

                return (
                    <Text>
                        pending:{String(pending)}|value:{value ? 'yes' : 'no'}
                    </Text>
                )
            }

            const { lastFrame } = render(<CancellableUser />)

            await new Promise(r => setTimeout(r, 50))

            expect(lastFrame()).toContain('pending:false')
            expect(lastFrame()).toContain('value:no')
        })

        it('should cleanup on unmount', async () => {

            let resolveCount = 0

            function PromiseUser() {

                const [value] = useEventPromise('build:complete')

                useEffect(() => {

                    if (value) resolveCount++
                }, [value])

                return <Text>waiting</Text>
            }

            const { unmount } = render(<PromiseUser />)

            await new Promise(r => setTimeout(r, 10))

            unmount()

            observer.emit('build:complete', {
                status: 'success',
                filesRun: 0,
                filesSkipped: 0,
                filesFailed: 0,
                durationMs: 0
            })

            await new Promise(r => setTimeout(r, 10))

            expect(resolveCount).toBe(0)
        })
    })
})
