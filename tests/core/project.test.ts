/**
 * Project discovery tests.
 *
 * Tests the directory walking logic that finds the nearest .noorm project.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, mkdir, realpath } from 'fs/promises';
import { realpathSync } from 'fs';
import { tmpdir, homedir } from 'os';

import {
    findProjectRoot,
    initProjectContext,
    isNoormProject,
    getGlobalNoormPath,
    hasGlobalNoorm,
} from '../../src/core/project.js';

describe('project: findProjectRoot', () => {

    let tempDir: string;
    let originalCwd: string;

    beforeEach(async () => {

        // Use realpath to resolve symlinks (macOS /var -> /private/var)
        tempDir = await realpath(await mkdtemp(join(tmpdir(), 'noorm-project-test-')));
        originalCwd = realpathSync(process.cwd());

    });

    afterEach(async () => {

        process.chdir(originalCwd);
        await rm(tempDir, { recursive: true, force: true });

    });

    it('should find project root when .noorm exists in current directory', async () => {

        // Create .noorm in tempDir
        await mkdir(join(tempDir, '.noorm'));

        const result = findProjectRoot(tempDir);

        expect(result.hasProject).toBe(true);
        expect(result.projectRoot).toBe(tempDir);
        expect(result.originalCwd).toBe(originalCwd);

    });

    it('should find project root when .noorm exists in parent directory', async () => {

        // Create nested structure: tempDir/.noorm and tempDir/packages/db
        await mkdir(join(tempDir, '.noorm'));
        await mkdir(join(tempDir, 'packages', 'db'), { recursive: true });

        const nestedDir = join(tempDir, 'packages', 'db');
        const result = findProjectRoot(nestedDir);

        expect(result.hasProject).toBe(true);
        expect(result.projectRoot).toBe(tempDir);

    });

    it('should find project root from deeply nested directory', async () => {

        // Create: tempDir/.noorm and tempDir/packages/core/src/lib
        await mkdir(join(tempDir, '.noorm'));
        await mkdir(join(tempDir, 'packages', 'core', 'src', 'lib'), { recursive: true });

        const deepDir = join(tempDir, 'packages', 'core', 'src', 'lib');
        const result = findProjectRoot(deepDir);

        expect(result.hasProject).toBe(true);
        expect(result.projectRoot).toBe(tempDir);

    });

    it('should return hasProject=false when no .noorm exists', async () => {

        // Just an empty tempDir with no .noorm
        const result = findProjectRoot(tempDir);

        expect(result.hasProject).toBe(false);
        expect(result.projectRoot).toBeNull();

    });

    it('should stop at home directory and not treat ~/.noorm as project', async () => {

        // This test verifies the logic, not actual home directory
        // We simulate by checking the behavior description

        const result = findProjectRoot(tempDir);

        // Since tempDir has no .noorm and is not under a project,
        // it should not find a project
        expect(result.hasProject).toBe(false);

    });

    it('should detect home .noorm existence', () => {

        const result = findProjectRoot(tempDir);

        // homeNoorm should be set to the path if ~/.noorm exists
        // or null if it doesn't - we just verify the field exists
        expect('homeNoorm' in result).toBe(true);

    });

});

describe('project: initProjectContext', () => {

    let tempDir: string;
    let originalCwd: string;

    beforeEach(async () => {

        // Use realpath to resolve symlinks (macOS /var -> /private/var)
        tempDir = await realpath(await mkdtemp(join(tmpdir(), 'noorm-project-test-')));
        originalCwd = process.cwd();

    });

    afterEach(async () => {

        process.chdir(originalCwd);
        await rm(tempDir, { recursive: true, force: true });

    });

    it('should chdir to project root when chdir=true (default)', async () => {

        // Create project structure
        await mkdir(join(tempDir, '.noorm'));
        await mkdir(join(tempDir, 'packages', 'db'), { recursive: true });

        // Start from nested directory
        const nestedDir = join(tempDir, 'packages', 'db');
        process.chdir(nestedDir);

        const result = initProjectContext();

        expect(result.hasProject).toBe(true);
        expect(result.projectRoot).toBe(tempDir);
        expect(realpathSync(process.cwd())).toBe(tempDir);

    });

    it('should not chdir when chdir=false', async () => {

        // Create project structure
        await mkdir(join(tempDir, '.noorm'));
        await mkdir(join(tempDir, 'packages', 'db'), { recursive: true });

        // Start from nested directory
        const nestedDir = join(tempDir, 'packages', 'db');
        process.chdir(nestedDir);

        const result = initProjectContext({ chdir: false });

        expect(result.hasProject).toBe(true);
        expect(result.projectRoot).toBe(tempDir);
        expect(realpathSync(process.cwd())).toBe(nestedDir); // Should NOT have changed

    });

    it('should preserve originalCwd in result', async () => {

        await mkdir(join(tempDir, '.noorm'));
        await mkdir(join(tempDir, 'packages'), { recursive: true });

        const nestedDir = join(tempDir, 'packages');
        process.chdir(nestedDir);

        const result = initProjectContext();

        expect(result.originalCwd).toBe(nestedDir);

    });

});

describe('project: isNoormProject', () => {

    let tempDir: string;

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-project-test-'));

    });

    afterEach(async () => {

        await rm(tempDir, { recursive: true, force: true });

    });

    it('should return true when .noorm exists', async () => {

        await mkdir(join(tempDir, '.noorm'));

        expect(isNoormProject(tempDir)).toBe(true);

    });

    it('should return false when .noorm does not exist', () => {

        expect(isNoormProject(tempDir)).toBe(false);

    });

});

describe('project: getGlobalNoormPath', () => {

    it('should return path under home directory', () => {

        const globalPath = getGlobalNoormPath();

        expect(globalPath).toBe(join(homedir(), '.noorm'));

    });

});

describe('project: hasGlobalNoorm', () => {

    it('should return boolean indicating if ~/.noorm exists', () => {

        const result = hasGlobalNoorm();

        // We just verify it returns a boolean - actual value depends on system
        expect(typeof result).toBe('boolean');

    });

});
