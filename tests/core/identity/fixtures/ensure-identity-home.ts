/**
 * Child process for `ensure-identity.test.ts`. `~/.noorm` is resolved from
 * `homedir()` when the storage module loads, so only a fresh process with
 * HOME repointed can aim it at a throwaway directory.
 *
 * Modes: `seed` saves a config under the key on disk, `ensure` runs
 * `ensureIdentity`, `read` decrypts the seeded config with the key on disk.
 */
import { tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';

import { ensureIdentity } from '../../../../src/core/identity/factory.js';
import { getNoormHomePath } from '../../../../src/core/identity/storage.js';
import { StateManager } from '../../../../src/core/state/manager.js';

const [mode, projectRoot] = process.argv.slice(2);

if (!realpathSync(getNoormHomePath()).startsWith(realpathSync(tmpdir())) || !projectRoot) {

    process.stderr.write(`refusing to run against ${getNoormHomePath()}`);
    process.exit(2);

}

if (mode === 'seed') {

    const state = new StateManager(projectRoot);

    await state.load();
    await state.setConfig('legacy', {
        name: 'legacy',
        type: 'local',
        isTest: false,
        access: { user: 'admin', agent: 'viewer' },
        connection: { dialect: 'postgres', host: 'localhost', port: 5432, database: 'legacy_db', user: 'app', password: 's3cret' },
    });

}

if (mode === 'ensure') {

    const result = await ensureIdentity({ name: 'Setup Person', email: 'setup@example.com', machine: 'setup-machine' });

    process.stdout.write(JSON.stringify(result));

}

if (mode === 'read') {

    const state = new StateManager(projectRoot);

    await state.load();
    process.stdout.write(state.getConfig('legacy')?.connection.database ?? '');

}

process.exit(0);
