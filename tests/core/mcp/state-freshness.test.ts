import { describe, expect, it, spyOn } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createMcpServer } from '../../../src/mcp/server.js';
import { serveModernMcp } from '../../../src/mcp/stdio.js';
import { createRegistry } from '../../../src/rpc/index.js';
import { StateManager, resetStateManager } from '../../../src/core/state/index.js';
import { resetSettingsManager } from '../../../src/core/settings/index.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';
import { encrypt, decrypt } from '../../../src/core/state/encryption/index.js';
import type { EncryptedPayload } from '../../../src/core/state/types.js';
import { Context } from '../../../src/sdk/context.js';

const responseSchema = z.object({
    id: z.number(), result: z.record(z.string(), z.unknown()).optional(),
    error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
});
type Response = z.infer<typeof responseSchema>;

describe('MCP request-local state', () => {

    it('honors role revocation and invisibility throughout a live session', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-mcp-fresh-'));
        const previous = process.cwd();
        let handle: StdioServerHandle | undefined;
        const [client, transport] = InMemoryTransport.createLinkedPair();
        try {

            process.chdir(root);
            resetStateManager();
            resetSettingsManager();
            const { privateKey } = await generateKeyPair();
            setKeyOverride(privateKey);
            const writer = new StateManager(root);
            await writer.load();
            const config = {
                name: 'dev', type: 'local' as const, isTest: false,
                access: { user: 'admin', agent: 'admin' },
                connection: { dialect: 'sqlite' as const, database: join(root, 'dev.db') },
            };

            const pending = new Map<number, (value: Response) => void>();
            let id = 0;
            client.onmessage = (message) => {

                const parsed = responseSchema.safeParse(message);
                if (!parsed.success) return;
                pending.get(parsed.data.id)?.(parsed.data);
                pending.delete(parsed.data.id);

            };
            handle = serveModernMcp(createMcpServer(createRegistry()), transport);
            await client.start();
            const request = async (method: string, params: Record<string, unknown> = {}) => {

                const requestId = ++id;
                const { promise, resolve } = Promise.withResolvers<Response>();
                pending.set(requestId, resolve);
                await client.send({ jsonrpc: '2.0', id: requestId, method, params: {
                    ...params, _meta: {
                        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                        'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
                        'io.modelcontextprotocol/clientInfo': { name: 'state-test', version: '1' },
                    },
                } });

                return promise;

            };
            const sql = (query: string) => request('tools/call', { name: 'sql', arguments: { config: 'dev', query } });
            const configs = () => request('tools/call', { name: 'list_configs', arguments: {} });
            const updateInAnotherProcess = async (role: string) => {

                const stateModule = new URL('../../../src/core/state/index.ts', import.meta.url).href;
                const script = `
                    import { StateManager } from ${JSON.stringify(stateModule)};
                    const state = new StateManager(process.env.TEST_ROOT, { privateKey: process.env.TEST_KEY });
                    await state.load();
                    const config = state.getConfig('dev');
                    await state.setConfig('dev', { ...config, access: {
                        user: 'admin',
                        agent: process.env.TEST_ROLE === 'false' ? false : process.env.TEST_ROLE,
                    } });
                `;
                const child = Bun.spawn([process.execPath, '-e', script], {
                    env: { ...process.env, TEST_ROOT: root, TEST_KEY: privateKey, TEST_ROLE: role },
                    stdout: 'pipe', stderr: 'pipe',
                });
                const code = await child.exited;
                if (code !== 0) throw new Error(await new globalThis.Response(child.stderr).text());

            };

            const missing = await sql('SELECT 1');
            const resourceParams = { uri: 'noorm://configs/dev/overview' };
            const missingResource = await request('resources/read', resourceParams);
            expect(missing.result?.['isError']).toBe(true);
            expect(missingResource.error?.['data']).toMatchObject({ uri: resourceParams.uri });
            const connect = spyOn(Context.prototype, 'connect');
            try {

                const settingsPath = join(root, '.noorm', 'settings.yml');
                await mkdir(join(root, '.noorm'), { recursive: true });
                await writeFile(settingsPath, 'access:\n  roles:\n    custom:\n      extends: viewer\n');
                await writer.setConfig('dev', { ...config, access: { user: 'custom', agent: false } });

                const expectInaccessible = async () => {

                    expect(JSON.stringify((await sql('SELECT 1')).result)).toBe(JSON.stringify(missing.result));
                    expect(JSON.stringify((await request('resources/read', resourceParams)).error))
                        .toBe(JSON.stringify(missingResource.error));
                    expect(JSON.stringify(await configs())).not.toContain('dev');
                    expect(JSON.stringify(await request('resources/list'))).not.toContain('noorm://configs/dev/');

                };
                await expectInaccessible();
                await writeFile(settingsPath, '{}');
                await expectInaccessible();

                // Simulate an older encrypted state with malformed explicit access.
                const statePath = writer.getStatePath();
                const payload = JSON.parse(await readFile(statePath, 'utf8')) as EncryptedPayload;
                const stored = JSON.parse(decrypt(payload, privateKey));
                stored.configs.dev.access = { user: 'custom' };
                await writeFile(statePath, JSON.stringify(encrypt(JSON.stringify(stored), privateKey)));
                await expectInaccessible();
                expect(connect).not.toHaveBeenCalled();

            }
            finally {

                connect.mockRestore();

            }
            await writer.setConfig('dev', config);

            const created = await sql('CREATE TABLE first_table (id INTEGER)');
            expect(created.result?.['isError'], JSON.stringify(created)).not.toBe(true);
            expect(JSON.stringify(await configs())).toContain('dev');
            expect(JSON.stringify(await request('resources/list'))).toContain('noorm://configs/dev/overview');

            await updateInAnotherProcess('viewer');
            const denied = await sql('CREATE TABLE denied_table (id INTEGER)');
            expect(denied.result?.['isError']).toBe(true);
            expect(JSON.stringify(denied)).toContain('sql:ddl');

            await updateInAnotherProcess('false');
            const hidden = await sql('SELECT 1');
            const hiddenResource = await request('resources/read', resourceParams);
            expect(hidden.result).toEqual(missing.result);
            expect(hiddenResource.error).toEqual(missingResource.error);
            expect(JSON.stringify(await configs())).not.toContain('dev');
            expect(JSON.stringify(await request('resources/list'))).not.toContain('noorm://configs/dev/');

        }
        finally {

            await client.close();
            await handle?.close();
            clearKeyOverride();
            resetStateManager();
            resetSettingsManager();
            process.chdir(previous);
            await rm(root, { recursive: true, force: true });

        }

    });

});
