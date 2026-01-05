/**
 * Vitest global teardown.
 *
 * Cleans up test artifacts after all tests complete.
 * Removes tmp/test-[hex] directories generated during test runs.
 */
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Pattern matching test directories (test-[8 hex chars]).
 */
const TEST_DIR_PATTERN = /^test-[0-9a-f]{8}$/;

export default async function globalTeardown(): Promise<void> {

    const tmpDir = join(process.cwd(), 'tmp');

    try {

        const entries = await readdir(tmpDir);
        const testDirs = entries.filter((name) => TEST_DIR_PATTERN.test(name));

        await Promise.all(
            testDirs.map((name) => rm(join(tmpDir, name), { recursive: true, force: true })),
        );

        if (testDirs.length > 0) {

            console.log(`\n🧹 Cleaned up ${testDirs.length} test directories`);

        }

    }
    catch {
        // tmp dir may not exist, ignore
    }

}
