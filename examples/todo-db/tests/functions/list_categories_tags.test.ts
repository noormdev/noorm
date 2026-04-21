/**
 * Coverage for `list_categories` and `list_tags` TVFs.
 *
 * Both are straightforward ORDER BY name + LIMIT/OFFSET; asserting the TVF
 * shape + ordering contract is enough.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

describe('functions/list_categories + list_tags', () => {

    let ctx: TestContext;
    const categoryCleanup: number[] = [];
    const tagCleanup: number[] = [];

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    afterAll(async () => {

        if (categoryCleanup.length > 0) {

            await ctx.kysely
                .deleteFrom('category')
                .where('id', 'in', categoryCleanup)
                .execute();

        }

        if (tagCleanup.length > 0) {

            await ctx.kysely
                .deleteFrom('tag')
                .where('id', 'in', tagCleanup)
                .execute();

        }

    });

    test('list_categories returns rows sorted by name', async () => {

        const prefix = `lc-${Math.random().toString(36).slice(2, 6)}`;
        const names = [`${prefix}-zebra`, `${prefix}-alpha`, `${prefix}-middle`];

        for (const name of names) {

            const row = await ctx.kysely
                .insertInto('category')
                .values({ name })
                .returning('id')
                .executeTakeFirstOrThrow();
            categoryCleanup.push(row.id);

        }

        const rows = await ctx.tvf('list_categories', { p_limit: 1000 });

        const mine = rows.filter((r) => r.name.startsWith(prefix));

        expect(mine.map((r) => r.name)).toEqual(
            [...names].sort(),
        );

    });

    test('list_tags returns rows sorted by name with defaulted color', async () => {

        const prefix = `lt-${Math.random().toString(36).slice(2, 6)}`;
        const names = [`${prefix}-beta`, `${prefix}-alpha`];

        for (const name of names) {

            const row = await ctx.kysely
                .insertInto('tag')
                .values({ name })
                .returning('id')
                .executeTakeFirstOrThrow();
            tagCleanup.push(row.id);

        }

        const rows = await ctx.tvf('list_tags', { p_limit: 1000 });
        const mine = rows.filter((r) => r.name.startsWith(prefix));

        expect(mine.map((r) => r.name)).toEqual([...names].sort());
        for (const row of mine) {

            expect(row.color).toBe('#808080');

        }

    });

    test('pagination: p_limit caps the result count', async () => {

        const prefix = `pg-${Math.random().toString(36).slice(2, 6)}`;
        const names = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`, `${prefix}-d`];

        for (const name of names) {

            const row = await ctx.kysely
                .insertInto('tag')
                .values({ name })
                .returning('id')
                .executeTakeFirstOrThrow();
            tagCleanup.push(row.id);

        }

        const page = await ctx.tvf('list_tags', { p_limit: 2, p_offset: 0 });

        expect(page.length).toBe(2);

    });

});
