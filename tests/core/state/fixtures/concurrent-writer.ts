/**
 * Subprocess fixture for the concurrent-writer test.
 *
 * Runs the real load -> mutate -> persist cycle in its own process so the
 * state file lock is exercised across OS processes rather than across two
 * objects sharing one event loop.
 *
 * Usage: bun run concurrent-writer.ts <projectRoot> <privateKey> <secretKey> <value>
 */
import { StateManager } from '../../../../src/core/state/manager.js';

const [projectRoot, privateKey, secretKey, value] = process.argv.slice(2);

const state = new StateManager(projectRoot!, {
    stateDir: '.test-state',
    stateFile: 'state.enc',
    privateKey: privateKey!,
});

await state.load();
await state.setSecret('dev', secretKey!, value!);
