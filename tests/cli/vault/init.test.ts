import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

const initializationRace = `
import { mock } from 'bun:test';
import * as actualUtils from './src/cli/_utils.ts';
import * as actualVault from './src/core/vault/index.ts';
import { attachPolicyContext } from './src/core/policy/index.ts';
const access = { user: 'admin', agent: 'viewer' };
attachPolicyContext(access, {});
const config = { name: 'race', access, connection: { dialect: 'sqlite', database: ':memory:' }, type: 'local' };
let statusReads = 0;
mock.module('./src/cli/_utils.ts', () => ({
    ...actualUtils,
    withVaultContext: async ({ fn }) => [await fn({
        ctx: { kysely: {}, noorm: { config }, dialect: 'sqlite' },
        cryptoIdentity: { identityHash: 'self', publicKey: 'unused' },
    }), null],
}));
mock.module('./src/core/vault/index.ts', () => ({
    ...actualVault,
    getVaultStatus: async () => ({
        isInitialized: statusReads++ > 0,
        hasAccess: statusReads > 1 && process.env.SMOKE_HAS_ACCESS === 'true',
        usersWithAccess: 1, usersWithoutAccess: 1,
    }),
    initializeVaultChecked: async () => [null, null],
}));
// The command must load after mock.module installs the concurrent-result boundary.
const command = (await import('./src/cli/vault/init.ts')).default;
await command.run({ args: { json: true, yes: true } });
`;

describe('CLI vault initialization during a concurrent initialization', () => {

    it.each([false, true])('reports the resulting access instead of claiming a new key was created (access=%s)', (hasAccess) => {

        const result = spawnSync(process.execPath, ['-e', initializationRace], {
            cwd: projectRoot,
            encoding: 'utf8',
            timeout: 30_000,
            env: { ...process.env, NOORM_CHANNEL: 'user', SMOKE_HAS_ACCESS: String(hasAccess) },
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(hasAccess ? 0 : 1);
        expect(JSON.parse(result.stdout)).toMatchObject({ success: hasAccess });

    });

});
