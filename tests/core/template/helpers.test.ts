/**
 * Template helpers tree walker tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import {
    findHelperFiles,
    loadHelpers,
} from '../../../src/core/template/helpers.js'


const TMP_DIR = path.join(process.cwd(), 'tmp/template-helpers-test')


describe('template: helpers', () => {

    beforeAll(async () => {

        await mkdir(TMP_DIR, { recursive: true })
    })

    afterAll(async () => {

        await rm(TMP_DIR, { recursive: true, force: true })
    })

    describe('findHelperFiles', () => {

        it('should find helper file in single directory', async () => {

            const testDir = path.join(TMP_DIR, 'find-single')
            await mkdir(testDir, { recursive: true })
            await writeFile(path.join(testDir, '$helpers.ts'), 'export const x = 1')

            const helpers = await findHelperFiles(testDir, testDir)

            expect(helpers).toHaveLength(1)
            expect(helpers[0]).toContain('$helpers.ts')
        })

        it('should find helpers in parent directories', async () => {

            const rootDir = path.join(TMP_DIR, 'find-parents')
            const childDir = path.join(rootDir, 'child')
            const grandchildDir = path.join(childDir, 'grandchild')

            await mkdir(grandchildDir, { recursive: true })
            await writeFile(path.join(rootDir, '$helpers.ts'), 'export const root = 1')
            await writeFile(path.join(childDir, '$helpers.ts'), 'export const child = 1')

            const helpers = await findHelperFiles(grandchildDir, rootDir)

            expect(helpers).toHaveLength(2)
            // Should be in root-to-leaf order
            expect(helpers[0]).toContain('find-parents/$helpers.ts')
            expect(helpers[1]).toContain('child/$helpers.ts')
        })

        it('should return empty array if no helpers exist', async () => {

            const testDir = path.join(TMP_DIR, 'find-none')
            await mkdir(testDir, { recursive: true })

            const helpers = await findHelperFiles(testDir, testDir)

            expect(helpers).toHaveLength(0)
        })

        it('should stop at project root', async () => {

            const rootDir = path.join(TMP_DIR, 'find-root-stop')
            const childDir = path.join(rootDir, 'child')

            await mkdir(childDir, { recursive: true })
            // Put helper above root (should be ignored)
            await writeFile(path.join(TMP_DIR, '$helpers.ts'), 'export const above = 1')
            await writeFile(path.join(rootDir, '$helpers.ts'), 'export const root = 1')

            const helpers = await findHelperFiles(childDir, rootDir)

            expect(helpers).toHaveLength(1)
            expect(helpers[0]).toContain('find-root-stop/$helpers.ts')
        })

        it('should prefer .ts over .js', async () => {

            const testDir = path.join(TMP_DIR, 'find-prefer-ts')
            await mkdir(testDir, { recursive: true })
            await writeFile(path.join(testDir, '$helpers.ts'), 'export const ts = 1')
            await writeFile(path.join(testDir, '$helpers.js'), 'export const js = 1')

            const helpers = await findHelperFiles(testDir, testDir)

            expect(helpers).toHaveLength(1)
            expect(helpers[0]).toContain('$helpers.ts')
        })

        it('should find .js if .ts does not exist', async () => {

            const testDir = path.join(TMP_DIR, 'find-js-fallback')
            await mkdir(testDir, { recursive: true })
            await writeFile(path.join(testDir, '$helpers.js'), 'export const js = 1')

            const helpers = await findHelperFiles(testDir, testDir)

            expect(helpers).toHaveLength(1)
            expect(helpers[0]).toContain('$helpers.js')
        })
    })

    describe('loadHelpers', () => {

        it('should load and merge helpers from tree', async () => {

            const rootDir = path.join(TMP_DIR, 'load-merge')
            const childDir = path.join(rootDir, 'child')

            await mkdir(childDir, { recursive: true })

            // Root helper
            await writeFile(path.join(rootDir, '$helpers.js'), `
                export function rootHelper() { return 'root' }
                export const shared = 'from-root'
            `)

            // Child helper (overrides shared)
            await writeFile(path.join(childDir, '$helpers.js'), `
                export function childHelper() { return 'child' }
                export const shared = 'from-child'
            `)

            const helpers = await loadHelpers(childDir, rootDir)

            expect(helpers['rootHelper']).toBeDefined()
            expect(helpers['childHelper']).toBeDefined()
            // Child should override root
            expect(helpers['shared']).toBe('from-child')
        })

        it('should return empty object if no helpers', async () => {

            const testDir = path.join(TMP_DIR, 'load-empty')
            await mkdir(testDir, { recursive: true })

            const helpers = await loadHelpers(testDir, testDir)

            expect(helpers).toEqual({})
        })

        it('should handle single helper file', async () => {

            const testDir = path.join(TMP_DIR, 'load-single')
            await mkdir(testDir, { recursive: true })

            await writeFile(path.join(testDir, '$helpers.js'), `
                export const NAME = 'test'
                export function greet() { return 'hello' }
            `)

            const helpers = await loadHelpers(testDir, testDir)

            expect(helpers['NAME']).toBe('test')
            expect(typeof helpers['greet']).toBe('function')
        })
    })
})
