import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { createContext, type Context } from '../../src/sdk/index.js';
import { resetStateManager } from '../../src/core/state/index.js';

describe('inline connections', () => {

    let inlineRoot: string | undefined;
    const inlineContexts: Context[] = [];

    afterEach(async () => {

        if (!inlineRoot) return;

        await Promise.all(inlineContexts.map((ctx) => ctx.disconnect()));
        resetStateManager();
        await rm(inlineRoot, { recursive: true, force: true });

        inlineRoot = undefined;
        inlineContexts.length = 0;

    });

    it('opens independent databases without stored state', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-inline-'));
        inlineRoot = root;
        resetStateManager();

        const [a, b] = await Promise.all([
            createContext({ projectRoot: root, connection: { dialect: 'sqlite', database: join(root, 'a.db') } }),
            createContext({ projectRoot: root, connection: { dialect: 'sqlite', database: join(root, 'b.db') } }),
        ]);
        inlineContexts.push(a, b);
        await Promise.all([a.connect(), b.connect()]);

        await sql`CREATE TABLE only_a (id integer)`.execute(a.kysely);
        const result = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'only_a'`.execute(b.kysely);
        expect(result.rows).toHaveLength(0);
        expect(a.noorm.config.name).toBe('__inline__');

        await expect(createContext({ projectRoot: root, connection: { dialect: 'sqlite' } })).rejects.toThrow();
        await expect(createContext({
            projectRoot: root, requireTest: true, connection: { dialect: 'sqlite', database: ':memory:' },
        })).rejects.toThrow();

    });

});
