/**
 * CLI types tests.
 *
 * Tests pure utility functions for route parsing.
 */
import { describe, it, expect } from 'vitest'

import { getSection, getParentRoute } from '../../src/cli/types.js'
import type { Route, Section } from '../../src/cli/types.js'


describe('cli: types', () => {

    describe('getSection', () => {

        it('should return section for single-part routes', () => {

            expect(getSection('home')).toBe('home')
            expect(getSection('config')).toBe('config')
            expect(getSection('settings')).toBe('settings')
            expect(getSection('change')).toBe('change')
            expect(getSection('run')).toBe('run')
            expect(getSection('db')).toBe('db')
            expect(getSection('lock')).toBe('lock')
            expect(getSection('identity')).toBe('identity')
            expect(getSection('init')).toBe('init')
        })

        it('should return section for multi-part routes', () => {

            expect(getSection('config/add')).toBe('config')
            expect(getSection('config/edit')).toBe('config')
            expect(getSection('config/rm')).toBe('config')
            expect(getSection('change/run')).toBe('change')
            expect(getSection('change/revert')).toBe('change')
            expect(getSection('run/build')).toBe('run')
            expect(getSection('run/file')).toBe('run')
            expect(getSection('db/create')).toBe('db')
            expect(getSection('db/destroy')).toBe('db')
            expect(getSection('lock/status')).toBe('lock')
            expect(getSection('identity/init')).toBe('identity')
        })

        it('should handle all defined sections', () => {

            const sections: Section[] = [
                'home',
                'config',
                'secret',
                'settings',
                'change',
                'run',
                'db',
                'lock',
                'identity',
                'init',
            ]

            for (const section of sections) {

                expect(getSection(section as Route)).toBe(section)
            }
        })
    })

    describe('getParentRoute', () => {

        it('should return null for home', () => {

            expect(getParentRoute('home')).toBeNull()
        })

        it('should return home for top-level routes', () => {

            expect(getParentRoute('config')).toBe('home')
            expect(getParentRoute('settings')).toBe('home')
            expect(getParentRoute('change')).toBe('home')
            expect(getParentRoute('run')).toBe('home')
            expect(getParentRoute('db')).toBe('home')
            expect(getParentRoute('lock')).toBe('home')
            expect(getParentRoute('identity')).toBe('home')
            expect(getParentRoute('init')).toBe('home')
        })

        it('should return parent section for nested routes', () => {

            expect(getParentRoute('config/add')).toBe('config')
            expect(getParentRoute('config/edit')).toBe('config')
            expect(getParentRoute('config/rm')).toBe('config')
            expect(getParentRoute('config/cp')).toBe('config')
            expect(getParentRoute('config/use')).toBe('config')
        })

        it('should return parent for all action routes', () => {

            const actionRoutes: Array<{ route: Route; parent: Route }> = [
                { route: 'config/add', parent: 'config' },
                { route: 'config/edit', parent: 'config' },
                { route: 'config/validate', parent: 'config' },
                { route: 'secret/set', parent: 'secret' },
                { route: 'secret/rm', parent: 'secret' },
                { route: 'settings/edit', parent: 'settings' },
                { route: 'settings/init', parent: 'settings' },
                { route: 'change/add', parent: 'change' },
                { route: 'change/run', parent: 'change' },
                { route: 'change/revert', parent: 'change' },
                { route: 'run/build', parent: 'run' },
                { route: 'run/file', parent: 'run' },
                { route: 'run/dir', parent: 'run' },
                { route: 'db/create', parent: 'db' },
                { route: 'db/destroy', parent: 'db' },
                { route: 'lock/status', parent: 'lock' },
                { route: 'lock/acquire', parent: 'lock' },
                { route: 'lock/release', parent: 'lock' },
                { route: 'identity/init', parent: 'identity' },
                { route: 'identity/export', parent: 'identity' },
            ]

            for (const { route, parent } of actionRoutes) {

                expect(getParentRoute(route)).toBe(parent)
            }
        })
    })
})
