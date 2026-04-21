/**
 * Prepare an isolated project root under tmp/ so the SDK has somewhere to
 * write state without touching the example's committed .noorm/ directory.
 *
 * The copy pulls in sql/ and changes/ verbatim and writes a minimal
 * settings.yml — the one committed next to the example declares secret
 * requirements that would force every config to carry API keys before tests
 * could run. A fresh settings.yml keeps the test path self-contained.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const helpersDir = dirname(__filename);
export const exampleRoot = resolve(helpersDir, '..', '..');
export const tmpProjectRoot = join(exampleRoot, 'tmp', 'test-root');

const SETTINGS_YML = `build:
    include: []
    exclude: []
paths:
    sql: ./sql
    changes: ./changes
rules: []
stages: {}
strict:
    enabled: false
    stages: []
logging:
    enabled: false
    level: info
    file: .noorm/state/noorm.log
    maxSize: 10mb
    maxFiles: 5
secrets: []
`;

/**
 * Copy the committed example into a throwaway project root and return its
 * absolute path. Safe to call repeatedly — each call resets the directory.
 */
export function prepareTmpProject(): string {

    if (existsSync(tmpProjectRoot)) {

        rmSync(tmpProjectRoot, { recursive: true, force: true });

    }

    mkdirSync(tmpProjectRoot, { recursive: true });

    cpSync(join(exampleRoot, 'sql'), join(tmpProjectRoot, 'sql'), { recursive: true });
    cpSync(join(exampleRoot, 'changes'), join(tmpProjectRoot, 'changes'), { recursive: true });

    const settingsPath = join(tmpProjectRoot, '.noorm', 'settings.yml');
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, SETTINGS_YML);

    return tmpProjectRoot;

}
