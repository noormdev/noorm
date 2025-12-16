import { describe, it, expect } from 'vitest'

import {
    DEFAULT_TIMEOUTS,
    createDefaultConfig,
} from '../../../src/core/lifecycle/types.js'


describe('lifecycle: types', () => {

    describe('DEFAULT_TIMEOUTS', () => {

        it('should have operations timeout', () => {

            expect(DEFAULT_TIMEOUTS.operations).toBe(30000)
        })

        it('should have locks timeout', () => {

            expect(DEFAULT_TIMEOUTS.locks).toBe(5000)
        })

        it('should have connections timeout', () => {

            expect(DEFAULT_TIMEOUTS.connections).toBe(10000)
        })

        it('should have logger timeout', () => {

            expect(DEFAULT_TIMEOUTS.logger).toBe(10000)
        })
    })

    describe('createDefaultConfig', () => {

        it('should create config with project root', () => {

            const config = createDefaultConfig('/project')

            expect(config.projectRoot).toBe('/project')
        })

        it('should use default mode', () => {

            const config = createDefaultConfig('/project')

            expect(config.mode).toBe('tui')
        })

        it('should use default timeouts', () => {

            const config = createDefaultConfig('/project')

            expect(config.timeouts).toEqual(DEFAULT_TIMEOUTS)
        })

        it('should enable signal handlers by default', () => {

            const config = createDefaultConfig('/project')

            expect(config.registerSignalHandlers).toBe(true)
        })

        it('should create independent timeout objects', () => {

            const config1 = createDefaultConfig('/project1')
            const config2 = createDefaultConfig('/project2')

            config1.timeouts.operations = 99999

            expect(config2.timeouts.operations).toBe(DEFAULT_TIMEOUTS.operations)
        })
    })
})
