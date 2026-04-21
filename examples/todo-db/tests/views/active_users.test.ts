/**
 * Read-coverage for the `v_active_users` view.
 *
 * Asserts the view's contract: rows with `deleted_at IS NULL` are visible
 * and rows with a non-null `deleted_at` are hidden. The view is the canonical
 * "live users" projection, so these two rules are the whole surface area.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

describe('views/v_active_users', () => {

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

    test('exposes live users with the documented column shape', async () => {

        const username = uid('alive');
        const email = `${username}@example.test`;

        const inserted = await ctx.kysely
            .insertInto('user')
            .values({ username, email })
            .returning('id')
            .executeTakeFirstOrThrow();

        createdIds.push(inserted.id);

        const row = await ctx.kysely
            .selectFrom('v_active_users')
            .selectAll()
            .where('id', '=', inserted.id)
            .executeTakeFirstOrThrow();

        // Column projection is a contract — if the view gains or drops columns,
        // consumers break. Assert every documented column.
        expect(Object.keys(row).sort()).toEqual(
            ['created_at', 'email', 'id', 'updated_at', 'username'].sort(),
        );
        expect(row.id).toBe(inserted.id);
        expect(row.username).toBe(username);
        expect(row.email).toBe(email);
        expect(row.created_at).toBeInstanceOf(Date);
        expect(row.updated_at).toBeInstanceOf(Date);

    });

    test('hides soft-deleted users', async () => {

        const username = uid('ghost');

        const { id } = await ctx.kysely
            .insertInto('user')
            .values({ username, email: `${username}@example.test` })
            .returning('id')
            .executeTakeFirstOrThrow();

        createdIds.push(id);

        await ctx.kysely
            .updateTable('user')
            .set({ deleted_at: new Date() })
            .where('id', '=', id)
            .execute();

        const hit = await ctx.kysely
            .selectFrom('v_active_users')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();

        expect(hit).toBeUndefined();

        // Sanity: the row still exists in the base table.
        const base = await ctx.kysely
            .selectFrom('user')
            .select(['id', 'deleted_at'])
            .where('id', '=', id)
            .executeTakeFirstOrThrow();

        expect(base.id).toBe(id);
        expect(base.deleted_at).toBeInstanceOf(Date);

    });

    test('restoring a soft-deleted user brings them back', async () => {

        const username = uid('revenant');

        const { id } = await ctx.kysely
            .insertInto('user')
            .values({ username, email: `${username}@example.test`, deleted_at: new Date() })
            .returning('id')
            .executeTakeFirstOrThrow();

        createdIds.push(id);

        const beforeRestore = await ctx.kysely
            .selectFrom('v_active_users')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();

        expect(beforeRestore).toBeUndefined();

        await ctx.kysely
            .updateTable('user')
            .set({ deleted_at: null })
            .where('id', '=', id)
            .execute();

        const afterRestore = await ctx.kysely
            .selectFrom('v_active_users')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirstOrThrow();

        expect(afterRestore.id).toBe(id);

    });

});
