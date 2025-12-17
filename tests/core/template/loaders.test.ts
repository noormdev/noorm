/**
 * Template loaders tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import {
    loadJson5,
    loadYaml,
    loadCsv,
    loadSql,
    loadDataFile,
    hasLoader,
    getLoader,
    getSupportedExtensions,
} from '../../../src/core/template/loaders/index.js'


const TMP_DIR = path.join(process.cwd(), 'tmp/template-loaders-test')


describe('template: loaders', () => {

    beforeAll(async () => {

        await mkdir(TMP_DIR, { recursive: true })
    })

    afterAll(async () => {

        await rm(TMP_DIR, { recursive: true, force: true })
    })

    describe('loadJson5', () => {

        it('should load standard JSON', async () => {

            const filepath = path.join(TMP_DIR, 'standard.json')
            await writeFile(filepath, '{"name": "test", "count": 42}')

            const data = await loadJson5(filepath)

            expect(data).toEqual({ name: 'test', count: 42 })
        })

        it('should load JSON5 with comments', async () => {

            const filepath = path.join(TMP_DIR, 'with-comments.json5')
            await writeFile(filepath, `{
                // Single line comment
                name: 'test',
                /* Block comment */
                count: 42,
            }`)

            const data = await loadJson5(filepath)

            expect(data).toEqual({ name: 'test', count: 42 })
        })

        it('should load JSON5 with trailing commas', async () => {

            const filepath = path.join(TMP_DIR, 'trailing-commas.json5')
            await writeFile(filepath, `{
                "items": [1, 2, 3,],
                "name": "test",
            }`)

            const data = await loadJson5(filepath)

            expect(data).toEqual({ items: [1, 2, 3], name: 'test' })
        })

        it('should load JSON5 with unquoted keys', async () => {

            const filepath = path.join(TMP_DIR, 'unquoted-keys.json5')
            await writeFile(filepath, `{ name: "test", count: 42 }`)

            const data = await loadJson5(filepath)

            expect(data).toEqual({ name: 'test', count: 42 })
        })
    })

    describe('loadYaml', () => {

        it('should load YAML objects', async () => {

            const filepath = path.join(TMP_DIR, 'config.yml')
            await writeFile(filepath, `
name: test
count: 42
nested:
  key: value
`)

            const data = await loadYaml(filepath)

            expect(data).toEqual({
                name: 'test',
                count: 42,
                nested: { key: 'value' },
            })
        })

        it('should load YAML arrays', async () => {

            const filepath = path.join(TMP_DIR, 'list.yml')
            await writeFile(filepath, `
- admin
- user
- guest
`)

            const data = await loadYaml(filepath)

            expect(data).toEqual(['admin', 'user', 'guest'])
        })
    })

    describe('loadCsv', () => {

        it('should load CSV with headers', async () => {

            const filepath = path.join(TMP_DIR, 'users.csv')
            await writeFile(filepath, `name,email,age
Alice,alice@example.com,30
Bob,bob@example.com,25`)

            const data = await loadCsv(filepath)

            expect(data).toEqual([
                { name: 'Alice', email: 'alice@example.com', age: '30' },
                { name: 'Bob', email: 'bob@example.com', age: '25' },
            ])
        })

        it('should skip empty lines', async () => {

            const filepath = path.join(TMP_DIR, 'with-empty.csv')
            await writeFile(filepath, `name,email

Alice,alice@example.com

Bob,bob@example.com
`)

            const data = await loadCsv(filepath)

            expect(data).toHaveLength(2)
        })

        it('should trim whitespace', async () => {

            const filepath = path.join(TMP_DIR, 'with-whitespace.csv')
            await writeFile(filepath, `name,email
  Alice  ,  alice@example.com  `)

            const data = await loadCsv(filepath)

            expect(data[0]).toEqual({ name: 'Alice', email: 'alice@example.com' })
        })
    })

    describe('loadSql', () => {

        it('should load SQL as raw text', async () => {

            const filepath = path.join(TMP_DIR, 'fragment.sql')
            const sql = 'SELECT * FROM users WHERE id = 1;'
            await writeFile(filepath, sql)

            const data = await loadSql(filepath)

            expect(data).toBe(sql)
        })

        it('should preserve whitespace', async () => {

            const filepath = path.join(TMP_DIR, 'multiline.sql')
            const sql = `SELECT
    id,
    name
FROM users;`
            await writeFile(filepath, sql)

            const data = await loadSql(filepath)

            expect(data).toBe(sql)
        })
    })

    describe('loadDataFile', () => {

        it('should auto-detect JSON extension', async () => {

            const filepath = path.join(TMP_DIR, 'auto.json')
            await writeFile(filepath, '{"test": true}')

            const data = await loadDataFile(filepath)

            expect(data).toEqual({ test: true })
        })

        it('should auto-detect YAML extension', async () => {

            const filepath = path.join(TMP_DIR, 'auto.yaml')
            await writeFile(filepath, 'test: true')

            const data = await loadDataFile(filepath)

            expect(data).toEqual({ test: true })
        })

        it('should throw for unsupported extension', async () => {

            const filepath = path.join(TMP_DIR, 'unknown.xyz')

            await expect(loadDataFile(filepath)).rejects.toThrow(
                'No loader registered for extension: .xyz'
            )
        })
    })

    describe('hasLoader', () => {

        it('should return true for supported extensions', () => {

            expect(hasLoader('.json')).toBe(true)
            expect(hasLoader('.json5')).toBe(true)
            expect(hasLoader('.yaml')).toBe(true)
            expect(hasLoader('.yml')).toBe(true)
            expect(hasLoader('.csv')).toBe(true)
            expect(hasLoader('.js')).toBe(true)
            expect(hasLoader('.ts')).toBe(true)
            expect(hasLoader('.sql')).toBe(true)
        })

        it('should return false for unsupported extensions', () => {

            expect(hasLoader('.xyz')).toBe(false)
            expect(hasLoader('.md')).toBe(false)
            expect(hasLoader('.txt')).toBe(false)
        })
    })

    describe('getLoader', () => {

        it('should return loader function for supported extension', () => {

            const loader = getLoader('.json5')

            expect(typeof loader).toBe('function')
        })

        it('should return undefined for unsupported extension', () => {

            const loader = getLoader('.xyz')

            expect(loader).toBeUndefined()
        })
    })

    describe('getSupportedExtensions', () => {

        it('should return array of extensions', () => {

            const extensions = getSupportedExtensions()

            expect(extensions).toContain('.json')
            expect(extensions).toContain('.json5')
            expect(extensions).toContain('.yaml')
            expect(extensions).toContain('.yml')
            expect(extensions).toContain('.csv')
            expect(extensions).toContain('.js')
            expect(extensions).toContain('.ts')
            expect(extensions).toContain('.sql')
        })
    })
})
