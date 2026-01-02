/**
 * Vitest global setup.
 *
 * Creates required directories before tests run.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export default function globalSetup(): void {

    const tmpDir = join(process.cwd(), 'tmp');

    if (!existsSync(tmpDir)) {

        mkdirSync(tmpDir, { recursive: true });

    }

}
