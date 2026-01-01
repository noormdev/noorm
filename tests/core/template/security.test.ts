/**
 * Template security tests.
 *
 * Tests path traversal prevention in the include() helper to ensure
 * templates cannot escape the project root and access arbitrary files.
 *
 * The include() helper uses path.resolve() to normalize paths and then
 * checks that the resolved path starts with the project root.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildContext } from '../../../src/core/template/context.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/security');
const PROJECT_ROOT = path.join(FIXTURES_DIR, 'project');
const TEMPLATE_PATH = path.join(PROJECT_ROOT, 'template.sql.tmpl');

describe('template: security', () => {

    describe('path traversal prevention', () => {

        it('should allow paths within project root', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Should successfully include file in same directory
            const result = await ctx.include('safe.sql');

            expect(result).toBe('-- Safe file within project\nSELECT 1;\n');

        });

        it('should allow relative paths resolving within project', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Should successfully include nested file
            const result = await ctx.include('subdir/nested.sql');

            expect(result).toBe('-- Nested safe file\nSELECT 2;\n');

        });

        it('should reject ../../../etc/passwd attempts', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Attempt to traverse up and access system files
            await expect(
                ctx.include('../../../../../../../etc/passwd'),
            ).rejects.toThrow('Include path escapes project root');

        });

        it('should reject absolute paths outside project', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            const outsidePath = path.join(FIXTURES_DIR, 'outside/secret.sql');

            // Attempt to include file outside project using absolute path
            await expect(
                ctx.include(outsidePath),
            ).rejects.toThrow('Include path escapes project root');

        });

        it('should handle paths with . and .. segments', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Path with . and .. that still resolves within project
            const result = await ctx.include('./subdir/../safe.sql');

            expect(result).toBe('-- Safe file within project\nSELECT 1;\n');

        });

        it('should reject paths that resolve outside even with complex traversal', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Complex path that resolves outside project
            await expect(
                ctx.include('./subdir/../../outside/secret.sql'),
            ).rejects.toThrow('Include path escapes project root');

        });

    });

    describe('edge cases', () => {

        it('should handle empty include path', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Empty path resolves to template directory itself
            await expect(
                ctx.include(''),
            ).rejects.toThrow();

        });

        it('should handle path with spaces', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Should successfully include file with spaces in name
            const result = await ctx.include('with spaces.sql');

            expect(result).toBe('-- File with spaces in name\nSELECT 3;\n');

        });

        it('should reject null byte injection attempts', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Null byte injection attempt (historically used to bypass extension checks)
            await expect(
                ctx.include('../outside/secret.sql\0.txt'),
            ).rejects.toThrow('Include path escapes project root');

        });

        it('should handle symbolic link traversal attempts', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Even if symlinks exist, path.resolve normalizes them
            await expect(
                ctx.include('../outside/secret.sql'),
            ).rejects.toThrow('Include path escapes project root');

        });

    });

    describe('template recursion security', () => {

        it('should prevent including templates outside project root', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Attempt to include template (.tmpl) outside project
            await expect(
                ctx.include('../outside/evil.sql.tmpl'),
            ).rejects.toThrow('Include path escapes project root');

        });

        it('should allow including templates within project root', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Include template within project - should work
            const result = await ctx.include('recursive.sql.tmpl');

            // The recursive template includes safe.sql (with its own comment)
            expect(result).toBe('-- Template that includes another template\n-- Safe file within project\nSELECT 1;\n');

        });

    });

    describe('platform-specific path handling', () => {

        it('should handle forward slashes consistently', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Forward slashes should work on all platforms
            const result = await ctx.include('subdir/nested.sql');

            expect(result).toBe('-- Nested safe file\nSELECT 2;\n');

        });

        it('should reject backslash traversal attempts on Windows-style paths', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // On Unix systems, backslashes are literal characters in filenames
            // The path won't resolve outside, but the file won't exist either
            // On Windows, path.resolve would normalize and catch this
            await expect(
                ctx.include('..\\..\\outside\\secret.sql'),
            ).rejects.toThrow();

        });

        it('should handle mixed slash styles', async () => {

            const ctx = await buildContext(TEMPLATE_PATH, {
                projectRoot: PROJECT_ROOT,
            });

            // Mixed slashes should still resolve correctly
            const result = await ctx.include('./subdir/nested.sql');

            expect(result).toBe('-- Nested safe file\nSELECT 2;\n');

        });

    });

});
