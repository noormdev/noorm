/**
 * Template helpers tree walker tests.
 *
 * Uses permanent fixture files in ./fixtures/helpers/ for testing.
 * See fixtures/helpers/ for example helper structures.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
    findHelperFiles,
    loadHelpers,
} from '../../../src/core/template/helpers.js'


const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/helpers')


describe('template: helpers', () => {

    describe('findHelperFiles', () => {

        it('should find helper file in single directory', async () => {

            const testDir = path.join(FIXTURES_DIR, 'find-single')

            const helpers = await findHelperFiles(testDir, testDir)

            expect(helpers).toHaveLength(1)
            expect(helpers[0]).toContain('$helpers.ts')
        })

        it('should find helpers in parent directories', async () => {

            const rootDir = path.join(FIXTURES_DIR, 'find-parents')
            const grandchildDir = path.join(rootDir, 'child', 'grandchild')

            const helpers = await findHelperFiles(grandchildDir, rootDir)

            expect(helpers).toHaveLength(2)
            // Should be in root-to-leaf order
            expect(helpers[0]).toContain('find-parents/$helpers.ts')
            expect(helpers[1]).toContain('child/$helpers.ts')
        })

        it('should return empty array if no helpers exist', async () => {

            const testDir = path.join(FIXTURES_DIR, 'find-none')

            const helpers = await findHelperFiles(testDir, testDir)

            expect(helpers).toHaveLength(0)
        })

        it('should stop at project root', async () => {

            const rootDir = path.join(FIXTURES_DIR, 'find-root-stop')
            const childDir = path.join(rootDir, 'child')

            const helpers = await findHelperFiles(childDir, rootDir)

            expect(helpers).toHaveLength(1)
            expect(helpers[0]).toContain('find-root-stop/$helpers.ts')
        })

        it('should prefer .ts over .js', async () => {

            const testDir = path.join(FIXTURES_DIR, 'find-prefer-ts')

            const helpers = await findHelperFiles(testDir, testDir)

            expect(helpers).toHaveLength(1)
            expect(helpers[0]).toContain('$helpers.ts')
        })

        it('should find .js if .ts does not exist', async () => {

            const testDir = path.join(FIXTURES_DIR, 'find-js-fallback')

            const helpers = await findHelperFiles(testDir, testDir)

            expect(helpers).toHaveLength(1)
            expect(helpers[0]).toContain('$helpers.js')
        })
    })

    describe('loadHelpers', () => {

        it('should load and merge helpers from tree', async () => {

            const rootDir = path.join(FIXTURES_DIR, 'load-merge')
            const childDir = path.join(rootDir, 'child')

            const helpers = await loadHelpers(childDir, rootDir)

            expect(helpers['rootHelper']).toBeDefined()
            expect(helpers['childHelper']).toBeDefined()
            // Child should override root
            expect(helpers['shared']).toBe('from-child')
        })

        it('should return empty object if no helpers', async () => {

            const testDir = path.join(FIXTURES_DIR, 'load-empty')

            const helpers = await loadHelpers(testDir, testDir)

            expect(helpers).toEqual({})
        })

        it('should handle single helper file', async () => {

            const testDir = path.join(FIXTURES_DIR, 'load-single')

            const helpers = await loadHelpers(testDir, testDir)

            expect(helpers['NAME']).toBe('test')
            expect(typeof helpers['greet']).toBe('function')
        })
    })
})
