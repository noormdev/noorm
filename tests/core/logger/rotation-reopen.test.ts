import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFile, writeFile, appendFile, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Logger, resetLogger } from '../../../src/core/logger/logger.js';
import { DEFAULT_LOGGER_CONFIG } from '../../../src/core/logger/types.js';
import type { Settings } from '../../../src/core/settings/types.js';

const settings = {} as Settings;

const LOG_REL_PATH = '.noorm/state/noorm.log';

/**
 * Rotation renames the log file out from under the live write stream. The open
 * fd follows the inode, so without a reopen every subsequent write lands in the
 * *rotated* file, `noorm.log` never comes back, and `needsRotation()` on the
 * now-missing path returns false forever — rotation fires exactly once and the
 * rotated file then grows without bound.
 *
 * These tests assert the intent (writes go to the live log, size limits keep
 * applying), not the mechanism, so a copy-truncate implementation would satisfy
 * them equally.
 */
describe('logger: rotation stream reopen', () => {

    let testDir: string;
    let logPath: string;

    beforeEach(async () => {

        testDir = join(
            tmpdir(),
            `noorm-test-rotreopen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        logPath = join(testDir, LOG_REL_PATH);

        await mkdir(join(testDir, '.noorm', 'state'), { recursive: true });

    });

    afterEach(async () => {

        await resetLogger();
        await rm(testDir, { recursive: true, force: true });

    });

    const makeLogger = () => new Logger({
        projectRoot: testDir,
        settings,
        config: { ...DEFAULT_LOGGER_CONFIG, maxSize: '1kb', maxFiles: 5 },
    });

    it('should recreate the log file after rotating it away', async () => {

        await writeFile(logPath, 'x'.repeat(4096));

        const logger = makeLogger();
        await logger.start();
        await logger.stop();

        const [stats, err] = await stat(logPath).then(
            (s) => [s, null] as const,
            (e: Error) => [null, e] as const,
        );

        expect(err).toBeNull();
        expect(stats).not.toBeNull();

    });

    it('should write post-rotation entries to the live log, not the rotated file', async () => {

        await writeFile(logPath, 'x'.repeat(4096));

        const logger = makeLogger();
        await logger.start();

        logger.info('AFTER-ROTATION-MARKER');

        await logger.flush();
        await logger.stop();

        const live = await readFile(logPath, 'utf-8');

        expect(live).toContain('AFTER-ROTATION-MARKER');

        const rotated = (await readdir(join(testDir, '.noorm', 'state')))
            .filter((f) => f !== 'noorm.log');

        expect(rotated.length).toBe(1);

        const rotatedContent = await readFile(
            join(testDir, '.noorm', 'state', rotated[0]!),
            'utf-8',
        );

        expect(rotatedContent).not.toContain('AFTER-ROTATION-MARKER');

    });

    it('should keep rotating on later cycles rather than firing once', async () => {

        await writeFile(logPath, 'x'.repeat(4096));

        const logger = makeLogger();
        await logger.start();

        logger.info('FIRST-CYCLE');
        await logger.flush();

        // Re-inflate the live log so a second rotation is due. If the stream was
        // orphaned this append goes to a file nothing is watching and the live
        // log stays absent, so no second rotation can ever happen.
        await appendFile(logPath, 'y'.repeat(4096));

        await logger.checkRotation();

        logger.info('SECOND-CYCLE');
        await logger.flush();
        await logger.stop();

        const live = await readFile(logPath, 'utf-8');

        // FIRST-CYCLE having moved out of the live log is the proof that a
        // second rotation fired; SECOND-CYCLE being in it is the proof the
        // stream was re-opened afterwards.
        expect(live).toContain('SECOND-CYCLE');
        expect(live).not.toContain('FIRST-CYCLE');

        const rotated = (await readdir(join(testDir, '.noorm', 'state')))
            .filter((f) => f !== 'noorm.log');

        const contents = await Promise.all(
            rotated.map((f) => readFile(join(testDir, '.noorm', 'state', f), 'utf-8')),
        );

        expect(contents.some((c) => c.includes('FIRST-CYCLE'))).toBe(true);

    });

    it('should create the log file 0600, not world-readable', async () => {

        const logger = makeLogger();
        await logger.start();

        logger.info('perm check');

        await logger.flush();
        await logger.stop();

        const stats = await stat(logPath);

        expect(stats.mode & 0o777).toBe(0o600);

    });

    it('should keep the rotated file 0600 too', async () => {

        await writeFile(logPath, 'x'.repeat(4096), { mode: 0o600 });

        const logger = makeLogger();
        await logger.start();
        await logger.stop();

        const rotated = (await readdir(join(testDir, '.noorm', 'state')))
            .filter((f) => f !== 'noorm.log');

        const stats = await stat(join(testDir, '.noorm', 'state', rotated[0]!));

        expect(stats.mode & 0o777).toBe(0o600);

    });

});
