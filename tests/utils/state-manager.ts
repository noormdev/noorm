/**
 * Hermetic StateManager for tests that hand-build a `ContextState`.
 *
 * Keeps the real `getStateManager(root)` out of them: it reads the developer's
 * `~/.noorm/identity.key` and any `state.enc` under the root.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateKeyPair } from '../../src/core/identity/crypto.js';
import { StateManager } from '../../src/core/state/index.js';

/**
 * A loaded StateManager over an empty temp directory with a throwaway key.
 *
 * @example
 * ```typescript
 * const stateManager = await loadedStateManager()
 * ```
 */
export async function loadedStateManager(): Promise<StateManager> {

    const root = mkdtempSync(join(tmpdir(), 'noorm-test-state-'));
    const { privateKey } = await generateKeyPair();
    const stateManager = new StateManager(root, { privateKey });

    await stateManager.load();

    return stateManager;

}
