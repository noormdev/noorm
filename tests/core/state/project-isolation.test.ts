import { expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';

import { initState, resetStateManager } from '../../../src/core/state/index.js';
import { resetSettingsManager } from '../../../src/core/settings/index.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';
import { createContext } from '../../../src/sdk/index.js';
import type { Context } from '../../../src/sdk/context.js';

it('resolves the requested project state after another project has been opened', async () => {

    const root = await mkdtemp(join(tmpdir(), 'noorm-project-isolation-'));
    const contexts: Context[] = [];
    resetStateManager();
    resetSettingsManager();
    setKeyOverride((await generateKeyPair()).privateKey);

    try {

        for (const name of ['first', 'second']) {

            const project = join(root, name);
            await mkdir(project);
            const state = await initState(project);
            await state.setConfig('shared-name', {
                name: 'shared-name', type: 'local', isTest: true,
                access: { user: 'admin', agent: 'viewer' },
                connection: { dialect: 'sqlite', database: join(project, 'db.sqlite') },
            });
            const ctx = await createContext({ projectRoot: project, config: 'shared-name', channel: 'agent' });
            contexts.push(ctx);
            await ctx.connect();
            await sql`CREATE TABLE origin (label TEXT)`.execute(ctx.kysely);
            await sql`INSERT INTO origin VALUES (${name})`.execute(ctx.kysely);

        }

        const reopened = await createContext({ projectRoot: join(root, 'first'), config: 'shared-name', channel: 'agent' });
        contexts.push(reopened);
        await reopened.connect();
        const result = await sql<{ label: string }>`SELECT label FROM origin`.execute(reopened.kysely);
        expect(result.rows).toEqual([{ label: 'first' }]);

    }
    finally {

        await Promise.all(contexts.map((ctx) => ctx.disconnect()));
        clearKeyOverride();
        resetStateManager();
        resetSettingsManager();
        await rm(root, { recursive: true, force: true });

    }

});
