/**
 * Template engine tests.
 *
 * Uses permanent fixture files in ./fixtures/engine/ for testing.
 *
 * Syntax (with custom tags):
 * - `{% code %}` for JavaScript code
 * - `{%= expr %}` for escaped output
 * - `{%~ expr %}` for raw output
 * - `$` as the context variable
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
    processFile,
    processFiles,
    renderTemplate,
    isTemplate,
} from '../../../src/core/template/engine.js';
import type { TemplateContext } from '../../../src/core/template/types.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/engine');

describe('template: engine', () => {

    describe('isTemplate', () => {

        it('should return true for .tmpl files', () => {

            expect(isTemplate('file.sql.tmpl')).toBe(true);
            expect(isTemplate('/path/to/file.sql.tmpl')).toBe(true);

        });

        it('should return false for regular .sql files', () => {

            expect(isTemplate('file.sql')).toBe(false);
            expect(isTemplate('/path/to/file.sql')).toBe(false);

        });

        it('should return false for other extensions', () => {

            expect(isTemplate('file.ts')).toBe(false);
            expect(isTemplate('file.json')).toBe(false);

        });

    });

    describe('renderTemplate', () => {

        it('should render simple output', async () => {

            const template = 'SELECT * FROM {%~ $.table %};';
            const context = { table: 'users' } as unknown as TemplateContext;

            const result = await renderTemplate(template, context);

            expect(result).toBe('SELECT * FROM users;');

        });

        it('should render code blocks', async () => {

            const template = '{% const x = 1 + 1; %}SELECT {%~ x %};';
            const context = {} as unknown as TemplateContext;

            const result = await renderTemplate(template, context);

            expect(result).toBe('SELECT 2;');

        });

        it('should render loops', async () => {

            const template = `
                {% for (const r of $.roles) { %}
                INSERT INTO roles (name) VALUES ('{%~ r %}');
                {% } %}
            `;
            const context = { roles: ['admin', 'user'] } as unknown as TemplateContext;

            const result = await renderTemplate(template, context);

            expect(result).toContain("VALUES ('admin');");
            expect(result).toContain("VALUES ('user');");

        });

        it('should render conditionals', async () => {

            const template = '{% if ($.debug) { %}-- DEBUG MODE{% } %}';
            const contextTrue = { debug: true } as unknown as TemplateContext;
            const contextFalse = { debug: false } as unknown as TemplateContext;

            expect(await renderTemplate(template, contextTrue)).toBe('-- DEBUG MODE');
            expect(await renderTemplate(template, contextFalse)).toBe('');

        });

        it('should use built-in helpers', async () => {

            const template = 'INSERT INTO t (id) VALUES (\'{%~ $.uuid() %}\');';
            const context = {
                uuid: () => 'test-uuid-123',
            } as unknown as TemplateContext;

            const result = await renderTemplate(template, context);

            expect(result).toContain("'test-uuid-123'");

        });

    });

    describe('processFile', () => {

        it('should process raw SQL files without rendering', async () => {

            const filepath = path.join(FIXTURES_DIR, 'raw.sql');

            const result = await processFile(filepath);

            expect(result.sql).toBe('SELECT * FROM users;');
            expect(result.isTemplate).toBe(false);
            expect(result.durationMs).toBeUndefined();

        });

        it('should process template files', async () => {

            const filepath = path.join(FIXTURES_DIR, 'template.sql.tmpl');

            const result = await processFile(filepath, {
                projectRoot: FIXTURES_DIR,
                config: { table: 'users' },
            });

            expect(result.sql).toBe('SELECT * FROM users;');
            expect(result.isTemplate).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should auto-load data files', async () => {

            const subDir = path.join(FIXTURES_DIR, 'auto-load');

            const result = await processFile(path.join(subDir, 'insert.sql.tmpl'), {
                projectRoot: FIXTURES_DIR,
            });

            expect(result.sql).toContain("VALUES ('admin');");
            expect(result.sql).toContain("VALUES ('user');");

        });

        it('should inherit helpers from parent directories', async () => {

            const rootDir = path.join(FIXTURES_DIR, 'inherit-helpers');
            const childDir = path.join(rootDir, 'child');

            const result = await processFile(path.join(childDir, 'test.sql.tmpl'), {
                projectRoot: rootDir,
            });

            expect(result.sql).toBe("SELECT 'HELLO';");

        });

        it('should provide secrets in context', async () => {

            const filepath = path.join(FIXTURES_DIR, 'secrets.sql.tmpl');

            const result = await processFile(filepath, {
                projectRoot: FIXTURES_DIR,
                secrets: { API_KEY: 'secret123' },
            });

            expect(result.sql).toBe("INSERT INTO config (key) VALUES ('secret123');");

        });

        it('should provide built-in helpers', async () => {

            const filepath = path.join(FIXTURES_DIR, 'builtin.sql.tmpl');

            const result = await processFile(filepath, {
                projectRoot: FIXTURES_DIR,
            });

            expect(result.sql).toBe("INSERT INTO t (v) VALUES ('O''Brien');");

        });

    });

    describe('processFiles', () => {

        it('should process multiple files', async () => {

            const filepath1 = path.join(FIXTURES_DIR, 'multi1.sql');
            const filepath2 = path.join(FIXTURES_DIR, 'multi2.sql');

            const results = await processFiles([filepath1, filepath2]);

            expect(results).toHaveLength(2);
            expect(results[0].sql).toBe('SELECT 1;');
            expect(results[1].sql).toBe('SELECT 2;');

        });

        it('should process mixed templates and raw files', async () => {

            const rawPath = path.join(FIXTURES_DIR, 'mixed-raw.sql');
            const tmplPath = path.join(FIXTURES_DIR, 'mixed-tmpl.sql.tmpl');

            const results = await processFiles([rawPath, tmplPath], {
                projectRoot: FIXTURES_DIR,
            });

            expect(results[0].isTemplate).toBe(false);
            expect(results[1].isTemplate).toBe(true);
            expect(results[0].sql).toBe('SELECT 1;');
            expect(results[1].sql).toBe('SELECT 2;');

        });

    });

});
