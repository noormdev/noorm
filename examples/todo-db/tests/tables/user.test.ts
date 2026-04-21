/**
 * Happy-path CRUD coverage for the `user` table via Kysely.
 *
 * These tests go through the typed query builder so the schema types in
 * `_helpers/schema.ts` are exercised alongside the SQL definitions in
 * `sql/00_tables/01_core.sql`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

describe('tables/user — CRUD via Kysely', () => {

    let ctx: TestContext;

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    const createdIds: number[] = [];

    afterAll(async () => {

        if (createdIds.length > 0) {

            await ctx.kysely
                .deleteFrom('user')
                .where('id', 'in', createdIds)
                .execute();

        }

    });

    test('insert: round-trips a new user with server-generated id + timestamps', async () => {

        const username = uid('alice');
        const email = `${username}@example.test`;

        const inserted = await ctx.kysely
            .insertInto('user')
            .values({ username, email })
            .returningAll()
            .executeTakeFirstOrThrow();

        createdIds.push(inserted.id);

        expect(inserted.id).toBeGreaterThan(0);
        expect(inserted.username).toBe(username);
        expect(inserted.email).toBe(email);
        expect(inserted.created_at).toBeInstanceOf(Date);
        expect(inserted.updated_at).toBeInstanceOf(Date);
        expect(inserted.deleted_at).toBeNull();

    });

    test('select: fetches back by id and by unique username', async () => {

        const username = uid('bob');
        const email = `${username}@example.test`;

        const { id } = await ctx.kysely
            .insertInto('user')
            .values({ username, email })
            .returning('id')
            .executeTakeFirstOrThrow();

        createdIds.push(id);

        const byId = await ctx.kysely
            .selectFrom('user')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirstOrThrow();

        const byUsername = await ctx.kysely
            .selectFrom('user')
            .selectAll()
            .where('username', '=', username)
            .executeTakeFirstOrThrow();

        expect(byId.id).toBe(id);
        expect(byUsername.id).toBe(id);
        expect(byId.email).toBe(email);

    });

    test('update: bumps email and updated_at, leaves created_at intact', async () => {

        const username = uid('carol');
        const originalEmail = `${username}@example.test`;
        const newEmail = `${username}+updated@example.test`;

        const inserted = await ctx.kysely
            .insertInto('user')
            .values({ username, email: originalEmail })
            .returningAll()
            .executeTakeFirstOrThrow();

        createdIds.push(inserted.id);

        // Sleep 10 ms so the new updated_at is strictly greater than the
        // insert-time value on low-resolution clocks.
        await new Promise((resolve) => setTimeout(resolve, 10));

        const updated = await ctx.kysely
            .updateTable('user')
            .set({ email: newEmail, updated_at: new Date() })
            .where('id', '=', inserted.id)
            .returningAll()
            .executeTakeFirstOrThrow();

        expect(updated.email).toBe(newEmail);
        expect(updated.created_at.getTime()).toBe(inserted.created_at.getTime());
        expect(updated.updated_at.getTime()).toBeGreaterThan(inserted.updated_at.getTime());

    });

    test('delete: removes the row and returns zero rows on subsequent select', async () => {

        const username = uid('dave');

        const { id } = await ctx.kysely
            .insertInto('user')
            .values({ username, email: `${username}@example.test` })
            .returning('id')
            .executeTakeFirstOrThrow();

        const result = await ctx.kysely
            .deleteFrom('user')
            .where('id', '=', id)
            .executeTakeFirst();

        expect(Number(result.numDeletedRows)).toBe(1);

        const leftover = await ctx.kysely
            .selectFrom('user')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();

        expect(leftover).toBeUndefined();

    });

});
