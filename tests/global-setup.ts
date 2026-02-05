/**
 * Vitest global setup.
 *
 * Creates required directories before tests run.
 * Returns a teardown function to clean up test artifacts.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Pattern matching test directories (test-[8 hex chars]).
 */
const TEST_DIR_PATTERN = /^test-[0-9a-f]{8}$/;

export default function globalSetup() {

    const tmpDir = join(process.cwd(), 'tmp');

    if (!existsSync(tmpDir)) {

        mkdirSync(tmpDir, { recursive: true });

    }

    // Return teardown function
    return async () => {

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

    };

}
