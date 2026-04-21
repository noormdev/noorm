/**
 * Happy-path CRUD coverage for the `category` table via Kysely.
 *
 * Exercises the SERIAL id + UNIQUE(name) constraint alongside the basic
 * select/update/delete surface area.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

describe('tables/category — CRUD via Kysely', () => {

    let ctx: TestContext;

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    const createdIds: number[] = [];

    afterAll(async () => {

        if (createdIds.length > 0) {

            await ctx.kysely
                .deleteFrom('category')
                .where('id', 'in', createdIds)
                .execute();

        }

    });

    test('insert: round-trips a category with server-generated id + created_at', async () => {

        const name = uid('work');

        const inserted = await ctx.kysely
            .insertInto('category')
            .values({ name, description: 'Work items' })
            .returningAll()
            .executeTakeFirstOrThrow();

        createdIds.push(inserted.id);

        expect(inserted.id).toBeGreaterThan(0);
        expect(inserted.name).toBe(name);
        expect(inserted.description).toBe('Work items');
        expect(inserted.created_at).toBeInstanceOf(Date);

    });

    test('select: fetches by id and by unique name', async () => {

        const name = uid('home');

        const { id } = await ctx.kysely
            .insertInto('category')
            .values({ name })
            .returning('id')
            .executeTakeFirstOrThrow();

        createdIds.push(id);

        const byId = await ctx.kysely
            .selectFrom('category')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirstOrThrow();

        const byName = await ctx.kysely
            .selectFrom('category')
            .selectAll()
            .where('name', '=', name)
            .executeTakeFirstOrThrow();

        expect(byId.id).toBe(id);
        expect(byName.id).toBe(id);
        expect(byId.description).toBeNull();

    });

    test('update: mutates description without affecting id or created_at', async () => {

        const name = uid('hobby');

        const inserted = await ctx.kysely
            .insertInto('category')
            .values({ name, description: 'initial' })
            .returningAll()
            .executeTakeFirstOrThrow();

        createdIds.push(inserted.id);

        const updated = await ctx.kysely
            .updateTable('category')
            .set({ description: 'updated' })
            .where('id', '=', inserted.id)
            .returningAll()
            .executeTakeFirstOrThrow();

        expect(updated.id).toBe(inserted.id);
        expect(updated.description).toBe('updated');
        expect(updated.created_at.getTime()).toBe(inserted.created_at.getTime());

    });

    test('delete: removes the row; subsequent select returns nothing', async () => {

        const name = uid('ephemeral');

        const { id } = await ctx.kysely
            .insertInto('category')
            .values({ name })
            .returning('id')
            .executeTakeFirstOrThrow();

        const result = await ctx.kysely
            .deleteFrom('category')
            .where('id', '=', id)
            .executeTakeFirst();

        expect(Number(result.numDeletedRows)).toBe(1);

        const leftover = await ctx.kysely
            .selectFrom('category')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();

        expect(leftover).toBeUndefined();

    });

    test('constraint: duplicate name raises a unique violation', async () => {

        const name = uid('dup');

        const { id } = await ctx.kysely
            .insertInto('category')
            .values({ name })
            .returning('id')
            .executeTakeFirstOrThrow();

        createdIds.push(id);

        const dupe = ctx.kysely
            .insertInto('category')
            .values({ name })
            .returning('id')
            .executeTakeFirst();

        await expect(dupe).rejects.toThrow(/duplicate key|unique/i);

    });

});
