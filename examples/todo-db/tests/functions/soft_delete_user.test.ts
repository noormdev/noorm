/**
 * Soft-delete lifecycle for the `user` table: soft_delete_user + restore_user.
 *
 * The pair is meant to be idempotent — second soft delete is a no-op, restore
 * on a live user is a no-op. These tests pin that contract plus the P0002
 * "user not found" raise path.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

async function seedUser(ctx: TestContext, prefix: string): Promise<number> {

    const username = uid(prefix);

    const row = await ctx.kysely
        .insertInto('user')
        .values({ username, email: `${username}@example.test` })
        .returning('id')
        .executeTakeFirstOrThrow();

    return row.id;

}

describe('functions/soft_delete_user + restore_user', () => {

    let ctx: TestContext;
    const userCleanup: number[] = [];

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    afterAll(async () => {

        if (userCleanup.length > 0) {

            await ctx.kysely
                .deleteFrom('user')
                .where('id', 'in', userCleanup)
                .execute();

        }

    });

    test('soft_delete_user stamps deleted_at and reports was_already_deleted=false', async () => {

        const userId = await seedUser(ctx, 'sd-first');
        userCleanup.push(userId);

        const [row] = await ctx.tvf('soft_delete_user', { p_user_id: userId });

        expect(row).toBeDefined();
        expect(row!.id).toBe(userId);
        expect(row!.was_already_deleted).toBe(false);
        expect(row!.deleted_at).toBeInstanceOf(Date);

        const persisted = await ctx.kysely
            .selectFrom('user')
            .select('deleted_at')
            .where('id', '=', userId)
            .executeTakeFirstOrThrow();

        expect(persisted.deleted_at).toBeInstanceOf(Date);

    });

    test('second soft_delete_user call is idempotent and flips was_already_deleted to true', async () => {

        const userId = await seedUser(ctx, 'sd-twice');
        userCleanup.push(userId);

        const [first] = await ctx.tvf('soft_delete_user', { p_user_id: userId });
        const [second] = await ctx.tvf('soft_delete_user', { p_user_id: userId });

        expect(first!.was_already_deleted).toBe(false);
        expect(second!.was_already_deleted).toBe(true);

        // Timestamp is preserved across the no-op call.
        expect(second!.deleted_at?.getTime()).toBe(first!.deleted_at?.getTime());

    });

    test('soft_delete_user raises P0002 when the user does not exist', async () => {

        const call = ctx.tvf('soft_delete_user', { p_user_id: -999_999 });

        await expect(call).rejects.toThrow(/user .* not found/i);

    });

    test('restore_user clears deleted_at on a soft-deleted user', async () => {

        const userId = await seedUser(ctx, 'rs-restore');
        userCleanup.push(userId);

        await ctx.tvf('soft_delete_user', { p_user_id: userId });

        const [restored] = await ctx.tvf('restore_user', { p_user_id: userId });

        expect(restored).toBeDefined();
        expect(restored!.id).toBe(userId);
        expect(restored!.deleted_at).toBeNull();

        const persisted = await ctx.kysely
            .selectFrom('user')
            .select('deleted_at')
            .where('id', '=', userId)
            .executeTakeFirstOrThrow();

        expect(persisted.deleted_at).toBeNull();

    });

    test('restore_user is a no-op on a live user and returns deleted_at=null', async () => {

        const userId = await seedUser(ctx, 'rs-live');
        userCleanup.push(userId);

        const [row] = await ctx.tvf('restore_user', { p_user_id: userId });

        expect(row).toBeDefined();
        expect(row!.deleted_at).toBeNull();

    });

    test('restore_user raises P0002 when the user does not exist', async () => {

        const call = ctx.tvf('restore_user', { p_user_id: -999_999 });

        await expect(call).rejects.toThrow(/user .* not found/i);

    });

});
