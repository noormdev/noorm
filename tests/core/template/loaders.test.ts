/**
 * Template loaders tests.
 *
 * Uses permanent fixture files in ./fixtures/loaders/ for testing.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
    loadJson5,
    loadYaml,
    loadCsv,
    loadSql,
    loadDataFile,
    hasLoader,
    getLoader,
    getSupportedExtensions,
} from '../../../src/core/template/loaders/index.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/loaders');

describe('template: loaders', () => {

    describe('loadJson5', () => {

        it('should load standard JSON', async () => {

            const filepath = path.join(FIXTURES_DIR, 'standard.json');

            const data = await loadJson5(filepath);

            expect(data).toEqual({ name: 'test', count: 42 });

        });

        it('should load JSON5 with comments', async () => {

            const filepath = path.join(FIXTURES_DIR, 'with-comments.json5');

            const data = await loadJson5(filepath);

            expect(data).toEqual({ name: 'test', count: 42 });

        });

        it('should load JSON5 with trailing commas', async () => {

            const filepath = path.join(FIXTURES_DIR, 'trailing-commas.json5');

            const data = await loadJson5(filepath);

            expect(data).toEqual({ items: [1, 2, 3], name: 'test' });

        });

        it('should load JSON5 with unquoted keys', async () => {

            const filepath = path.join(FIXTURES_DIR, 'unquoted-keys.json5');

            const data = await loadJson5(filepath);

            expect(data).toEqual({ name: 'test', count: 42 });

        });

    });

    describe('loadYaml', () => {

        it('should load YAML objects', async () => {

            const filepath = path.join(FIXTURES_DIR, 'config.yml');

            const data = await loadYaml(filepath);

            expect(data).toEqual({
                name: 'test',
                count: 42,
                nested: { key: 'value' },
            });

        });

        it('should load YAML arrays', async () => {

            const filepath = path.join(FIXTURES_DIR, 'list.yml');

            const data = await loadYaml(filepath);

            expect(data).toEqual(['admin', 'user', 'guest']);

        });

    });

    describe('loadCsv', () => {

        it('should load CSV with headers', async () => {

            const filepath = path.join(FIXTURES_DIR, 'users.csv');

            const data = await loadCsv(filepath);

            expect(data).toEqual([
                { name: 'Alice', email: 'alice@example.com', age: '30' },
                { name: 'Bob', email: 'bob@example.com', age: '25' },
            ]);

        });

        it('should skip empty lines', async () => {

            const filepath = path.join(FIXTURES_DIR, 'with-empty.csv');

            const data = await loadCsv(filepath);

            expect(data).toHaveLength(2);

        });

        it('should trim whitespace', async () => {

            const filepath = path.join(FIXTURES_DIR, 'with-whitespace.csv');

            const data = await loadCsv(filepath);

            expect(data[0]).toEqual({ name: 'Alice', email: 'alice@example.com' });

        });

    });

    describe('loadSql', () => {

        it('should load SQL as raw text', async () => {

            const filepath = path.join(FIXTURES_DIR, 'fragment.sql');

            const data = await loadSql(filepath);

            expect(data).toBe('SELECT * FROM users WHERE id = 1;');

        });

        it('should preserve whitespace', async () => {

            const filepath = path.join(FIXTURES_DIR, 'multiline.sql');

            const data = await loadSql(filepath);

            expect(data).toBe(`SELECT
    id,
    name
FROM users;`);

        });

    });

    describe('loadDataFile', () => {

        it('should auto-detect JSON extension', async () => {

            const filepath = path.join(FIXTURES_DIR, 'auto.json');

            const data = await loadDataFile(filepath);

            expect(data).toEqual({ test: true });

        });

        it('should auto-detect YAML extension', async () => {

            const filepath = path.join(FIXTURES_DIR, 'auto.yaml');

            const data = await loadDataFile(filepath);

            expect(data).toEqual({ test: true });

        });

        it('should throw for unsupported extension', async () => {

            const filepath = path.join(FIXTURES_DIR, 'unknown.xyz');

            await expect(loadDataFile(filepath)).rejects.toThrow(
                'No loader registered for extension: .xyz',
            );

        });

    });

    describe('hasLoader', () => {

        it('should return true for supported extensions', () => {

            expect(hasLoader('.json')).toBe(true);
            expect(hasLoader('.json5')).toBe(true);
            expect(hasLoader('.yaml')).toBe(true);
            expect(hasLoader('.yml')).toBe(true);
            expect(hasLoader('.csv')).toBe(true);
            expect(hasLoader('.js')).toBe(true);
            expect(hasLoader('.ts')).toBe(true);
            expect(hasLoader('.sql')).toBe(true);

        });

        it('should return false for unsupported extensions', () => {

            expect(hasLoader('.xyz')).toBe(false);
            expect(hasLoader('.md')).toBe(false);
            expect(hasLoader('.txt')).toBe(false);

        });

    });

    describe('getLoader', () => {

        it('should return loader function for supported extension', () => {

            const loader = getLoader('.json5');

            expect(typeof loader).toBe('function');

        });

        it('should return undefined for unsupported extension', () => {

            const loader = getLoader('.xyz');

            expect(loader).toBeUndefined();

        });

    });

    describe('getSupportedExtensions', () => {

        it('should return array of extensions', () => {

            const extensions = getSupportedExtensions();

            expect(extensions).toContain('.json');
            expect(extensions).toContain('.json5');
            expect(extensions).toContain('.yaml');
            expect(extensions).toContain('.yml');
            expect(extensions).toContain('.csv');
            expect(extensions).toContain('.js');
            expect(extensions).toContain('.ts');
            expect(extensions).toContain('.sql');

        });

    });

});
