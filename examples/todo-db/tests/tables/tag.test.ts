/**
 * Happy-path CRUD coverage for the `tag` table via Kysely.
 *
 * Verifies the `#808080` color default, the UNIQUE(name) constraint, and the
 * basic update/delete path.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

describe('tables/tag — CRUD via Kysely', () => {

    let ctx: TestContext;

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    const createdIds: number[] = [];

    afterAll(async () => {

        if (createdIds.length > 0) {

            await ctx.kysely
                .deleteFrom('tag')
                .where('id', 'in', createdIds)
                .execute();

        }

    });

    test('insert: default color applied when color is omitted', async () => {

        const name = uid('urgent');

        const inserted = await ctx.kysely
            .insertInto('tag')
            .values({ name })
            .returningAll()
            .executeTakeFirstOrThrow();

        createdIds.push(inserted.id);

        expect(inserted.name).toBe(name);
        expect(inserted.color).toBe('#808080');
        expect(inserted.created_at).toBeInstanceOf(Date);

    });

    test('insert: explicit color overrides the default', async () => {

        const name = uid('green');

        const inserted = await ctx.kysely
            .insertInto('tag')
            .values({ name, color: '#00ff00' })
            .returningAll()
            .executeTakeFirstOrThrow();

        createdIds.push(inserted.id);

        expect(inserted.color).toBe('#00ff00');

    });

    test('update: renames tag and changes color', async () => {

        const name = uid('temp');
        const newName = `${name}-renamed`;

        const inserted = await ctx.kysely
            .insertInto('tag')
            .values({ name })
            .returning(['id', 'name', 'color'])
            .executeTakeFirstOrThrow();

        createdIds.push(inserted.id);

        const updated = await ctx.kysely
            .updateTable('tag')
            .set({ name: newName, color: '#ff0000' })
            .where('id', '=', inserted.id)
            .returningAll()
            .executeTakeFirstOrThrow();

        expect(updated.name).toBe(newName);
        expect(updated.color).toBe('#ff0000');

    });

    test('delete: removes the row', async () => {

        const name = uid('gone');

        const { id } = await ctx.kysely
            .insertInto('tag')
            .values({ name })
            .returning('id')
            .executeTakeFirstOrThrow();

        const result = await ctx.kysely
            .deleteFrom('tag')
            .where('id', '=', id)
            .executeTakeFirst();

        expect(Number(result.numDeletedRows)).toBe(1);

        const leftover = await ctx.kysely
            .selectFrom('tag')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();

        expect(leftover).toBeUndefined();

    });

    test('constraint: duplicate tag name raises a unique violation', async () => {

        const name = uid('dup-tag');

        const { id } = await ctx.kysely
            .insertInto('tag')
            .values({ name })
            .returning('id')
            .executeTakeFirstOrThrow();

        createdIds.push(id);

        const dupe = ctx.kysely
            .insertInto('tag')
            .values({ name })
            .returning('id')
            .executeTakeFirst();

        await expect(dupe).rejects.toThrow(/duplicate key|unique/i);

    });

});
