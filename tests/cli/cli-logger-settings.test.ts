import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { attempt } from '@logosdx/utils';

import { createCliLogger } from '../../src/cli/_utils.js';
import { getSettingsManager, resetSettingsManager } from '../../src/core/settings/index.js';
import { resetLogger } from '../../src/core/logger/index.js';

/**
 * `createCliLogger` builds the Logger every one of the ~79 CLI commands runs
 * under. It used to hardcode `enabled: true` and the log path, so every
 * `settings.logging.*` value was dead for the whole CLI — and the Shift+L TUI
 * overlay, which reads `settings.logging.file`, pointed at a file the CLI
 * never wrote.
 */
describe('cli: createCliLogger settings', () => {

    let projectRoot: string;

    const writeSettings = async (yaml: string) => {

        await mkdir(join(projectRoot, '.noorm'), { recursive: true });
        await writeFile(join(projectRoot, '.noorm', 'settings.yml'), yaml);

    };

    const exists = async (path: string) => stat(path).then(() => true, () => false);

    /**
     * Describe what the settings layer actually resolved.
     *
     * These assertions all reduce to "did `createCliLogger` read settings.yml",
     * and a bare `expected true, received false` cannot distinguish a missing
     * file from a stale singleton from a load that threw. Every one of those
     * has looked identical while chasing a failure that reproduces only on CI.
     */
    const diagnose = async () => {

        const file = join(projectRoot, '.noorm', 'settings.yml');
        const onDisk = await exists(file);
        const raw = onDisk ? await readFile(file, 'utf-8') : '<absent>';

        const manager = getSettingsManager(projectRoot);
        const [, loadErr] = await attempt(() => manager.load());

        return [
            `projectRoot=${projectRoot}`,
            `settings.yml on disk=${onDisk}`,
            `raw=${JSON.stringify(raw)}`,
            `manager.settingsFilePath=${manager.settingsFilePath}`,
            `load error=${loadErr ? loadErr.message : 'none'}`,
            `resolved logging=${JSON.stringify(manager.settings?.logging ?? null)}`,
        ].join(' | ');

    };

    beforeEach(async () => {

        // The settings manager is a process-wide singleton keyed on the first
        // projectRoot it sees; without a reset every case after the first would
        // silently read the previous case's settings.
        resetSettingsManager();

        projectRoot = join(
            tmpdir(),
            `noorm-test-clilogger-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );

        await mkdir(projectRoot, { recursive: true });

    });

    afterEach(async () => {

        await resetLogger();
        resetSettingsManager();
        await rm(projectRoot, { recursive: true, force: true });

    });

    it('should not create a log file when logging.enabled is false', async () => {

        await writeSettings('logging:\n  enabled: false\n');

        const logger = await createCliLogger(projectRoot, false);
        await logger.start();

        logger.info('should not be persisted');

        await logger.flush();
        await logger.stop();

        expect(await exists(join(projectRoot, '.noorm', 'state', 'noorm.log')), await diagnose()).toBe(false);

    });

    it('should still emit console output when file logging is disabled', async () => {

        await writeSettings('logging:\n  enabled: false\n');

        const logger = await createCliLogger(projectRoot, true);
        await logger.start();

        // Disabling file logging must not disable the logger itself — `--json`
        // result output for every headless command runs through it.
        expect(logger.state).toBe('running');

        await logger.stop();

    });

    it('should honour a custom logging.file path', async () => {

        await writeSettings('logging:\n  enabled: true\n  file: .noorm/state/custom.log\n');

        const logger = await createCliLogger(projectRoot, false);
        await logger.start();

        logger.info('custom path entry');

        await logger.flush();
        await logger.stop();

        const custom = join(projectRoot, '.noorm', 'state', 'custom.log');

        expect(await exists(custom), await diagnose()).toBe(true);
        expect(await readFile(custom, 'utf-8')).toContain('custom path entry');

        expect(await exists(join(projectRoot, '.noorm', 'state', 'noorm.log'))).toBe(false);

    });

    it('should honour logging.level from settings', async () => {

        await writeSettings('logging:\n  enabled: true\n  level: error\n');

        const logger = await createCliLogger(projectRoot, false);

        expect(logger.level, await diagnose()).toBe('error');

    });

    it('should honour logging.maxSize and rotate at the configured limit', async () => {

        await writeSettings('logging:\n  enabled: true\n  maxSize: 1kb\n  maxFiles: 3\n');

        await mkdir(join(projectRoot, '.noorm', 'state'), { recursive: true });
        await writeFile(join(projectRoot, '.noorm', 'state', 'noorm.log'), 'x'.repeat(4096));

        const logger = await createCliLogger(projectRoot, false);
        await logger.start();
        await logger.stop();

        // A 4kb file under the hardcoded 10mb default would never rotate.
        const { readdir } = await import('node:fs/promises');
        const rotated = (await readdir(join(projectRoot, '.noorm', 'state')))
            .filter((f) => f !== 'noorm.log');

        expect(rotated.length, await diagnose()).toBe(1);

    });

    it('should default to the standard path when settings are absent', async () => {

        const logger = await createCliLogger(projectRoot, false);
        await logger.start();

        logger.info('default path entry');

        await logger.flush();
        await logger.stop();

        expect(await exists(join(projectRoot, '.noorm', 'state', 'noorm.log'))).toBe(true);

    });

});
