/**
 * Failure-mode + edge-case coverage.
 *
 * The happy-path tests in the sibling folders prove the schema and SDK work
 * when every caller is well-behaved. This file covers the other side: what
 * the database actually does when callers misbehave — unique/FK/CHECK/NOT
 * NULL violations, transaction rollback, concurrent-write contention, NULL
 * handling in TVF parameters, and the custom-RAISE error codes that stored
 * procs use to signal domain errors.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'kysely';
import { Client } from 'pg';

import type { TestContext } from '../_helpers/context.js';
import { getTestConnection } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

interface Owner {
    userId: number;
    categoryId: number;
}

async function seedOwner(ctx: TestContext, prefix: string): Promise<Owner> {

    const username = uid(prefix);
    const categoryName = uid(`${prefix}-cat`);

    const user = await ctx.kysely
        .insertInto('user')
        .values({ username, email: `${username}@example.test` })
        .returning('id')
        .executeTakeFirstOrThrow();

    const category = await ctx.kysely
        .insertInto('category')
        .values({ name: categoryName })
        .returning('id')
        .executeTakeFirstOrThrow();

    return { userId: user.id, categoryId: category.id };

}

describe('edge/failure modes — constraints, transactions, concurrency, NULLs, RAISE codes', () => {

    let ctx: TestContext;
    const userCleanup: number[] = [];
    const categoryCleanup: number[] = [];

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

        if (categoryCleanup.length > 0) {

            await ctx.kysely
                .deleteFrom('category')
                .where('id', 'in', categoryCleanup)
                .execute();

        }

    });

    // ─────────────────────────────────────────────────────────────
    // Constraint violations
    // ─────────────────────────────────────────────────────────────

    describe('constraint violations surface as Postgres errors', () => {

        test('duplicate username raises unique_violation (23505)', async () => {

            const username = uid('edge-uniq');

            const inserted = await ctx.kysely
                .insertInto('user')
                .values({ username, email: `${username}@example.test` })
                .returning('id')
                .executeTakeFirstOrThrow();

            userCleanup.push(inserted.id);

            const second = ctx.kysely
                .insertInto('user')
                .values({ username, email: `${username}-other@example.test` })
                .execute();

            await expect(second).rejects.toThrow(/duplicate key|unique/i);

        });

        test('FK to missing user on todo raises foreign_key_violation (23503)', async () => {

            const owner = await seedOwner(ctx, 'edge-fk');
            userCleanup.push(owner.userId);
            categoryCleanup.push(owner.categoryId);

            const insert = ctx.kysely
                .insertInto('todo')
                .values({
                    user_id: -1,
                    category_id: owner.categoryId,
                    created_at: new Date(),
                    title: 'orphan',
                })
                .execute();

            await expect(insert).rejects.toThrow(/foreign key|user_manages_todo/i);

        });

        test('ON DELETE RESTRICT blocks deleting a category that still has todos', async () => {

            const owner = await seedOwner(ctx, 'edge-restrict');
            userCleanup.push(owner.userId);
            categoryCleanup.push(owner.categoryId);

            await ctx.kysely
                .insertInto('todo')
                .values({
                    user_id: owner.userId,
                    category_id: owner.categoryId,
                    created_at: new Date(),
                    title: 'holds category alive',
                })
                .execute();

            const drop = ctx.kysely
                .deleteFrom('category')
                .where('id', '=', owner.categoryId)
                .execute();

            await expect(drop).rejects.toThrow(/foreign key|todo_is_categorized_by_category/i);

        });

        test('CHECK constraint rejects priority outside 0..5', async () => {

            const owner = await seedOwner(ctx, 'edge-check');
            userCleanup.push(owner.userId);
            categoryCleanup.push(owner.categoryId);

            const insert = ctx.kysely
                .insertInto('todo')
                .values({
                    user_id: owner.userId,
                    category_id: owner.categoryId,
                    created_at: new Date(),
                    title: 'overclocked',
                    priority: 42,
                })
                .execute();

            await expect(insert).rejects.toThrow(/chk_todo_priority|check constraint/i);

        });

        test('NOT NULL on user.email rejects rows with missing email', async () => {

            const username = uid('edge-notnull');

            const insert = sql`
                INSERT INTO "user" (username, email)
                VALUES (${username}, NULL)
            `.execute(ctx.kysely);

            await expect(insert).rejects.toThrow(/null value|not-null|23502/i);

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Transaction rollback
    // ─────────────────────────────────────────────────────────────

    describe('ctx.transaction commits on success and rolls back on throw', () => {

        test('throwing inside transaction reverts every write made before the throw', async () => {

            const username = uid('edge-tx-rollback');
            const email = `${username}@example.test`;

            const run = ctx.transaction(async (trx) => {

                await trx
                    .insertInto('user')
                    .values({ username, email })
                    .execute();

                // Sanity: the row is visible inside the transaction.
                const inside = await trx
                    .selectFrom('user')
                    .select('id')
                    .where('username', '=', username)
                    .executeTakeFirst();

                expect(inside).toBeDefined();

                throw new Error('force rollback');

            });

            await expect(run).rejects.toThrow(/force rollback/);

            const leaked = await ctx.kysely
                .selectFrom('user')
                .select('id')
                .where('username', '=', username)
                .executeTakeFirst();

            expect(leaked).toBeUndefined();

        });

        test('successful transaction commits writes atomically', async () => {

            const username = uid('edge-tx-commit');
            const email = `${username}@example.test`;

            const userId = await ctx.transaction(async (trx) => {

                const user = await trx
                    .insertInto('user')
                    .values({ username, email })
                    .returning('id')
                    .executeTakeFirstOrThrow();

                return user.id;

            });

            userCleanup.push(userId);

            const persisted = await ctx.kysely
                .selectFrom('user')
                .select('id')
                .where('id', '=', userId)
                .executeTakeFirstOrThrow();

            expect(persisted.id).toBe(userId);

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Concurrent update — SELECT FOR UPDATE contention
    // ─────────────────────────────────────────────────────────────

    describe('concurrent writers on the same row', () => {

        test('SELECT FOR UPDATE NOWAIT errors when another tx holds the row lock', async () => {

            const owner = await seedOwner(ctx, 'edge-lock');
            userCleanup.push(owner.userId);
            categoryCleanup.push(owner.categoryId);

            const conn = getTestConnection();
            const holder = new Client({
                host: conn.host,
                port: conn.port,
                user: conn.user,
                password: conn.password,
                database: conn.database,
            });

            const challenger = new Client({
                host: conn.host,
                port: conn.port,
                user: conn.user,
                password: conn.password,
                database: conn.database,
            });

            await holder.connect();
            await challenger.connect();

            await holder.query('BEGIN');
            await holder.query(
                'SELECT id FROM "user" WHERE id = $1 FOR UPDATE',
                [owner.userId],
            );

            await challenger.query('BEGIN');
            const nowaitAttempt = challenger.query(
                'SELECT id FROM "user" WHERE id = $1 FOR UPDATE NOWAIT',
                [owner.userId],
            );

            await expect(nowaitAttempt).rejects.toThrow(/could not obtain lock|lock_not_available/i);

            await challenger.query('ROLLBACK');
            await holder.query('ROLLBACK');

            await challenger.end();
            await holder.end();

        });

    });

    // ─────────────────────────────────────────────────────────────
    // NULL / optional parameter handling in TVFs
    // ─────────────────────────────────────────────────────────────

    describe('TVFs treat NULL / omitted params as "no filter"', () => {

        test('search_todos with p_status=null returns rows in every status', async () => {

            const owner = await seedOwner(ctx, 'edge-null');
            userCleanup.push(owner.userId);
            categoryCleanup.push(owner.categoryId);

            const keyword = uid('edge-null-kw');

            // Seed three todos with different statuses, all matching the keyword.
            const base = Date.now();
            await ctx.kysely
                .insertInto('todo')
                .values([
                    {
                        user_id: owner.userId,
                        category_id: owner.categoryId,
                        created_at: new Date(base),
                        title: `${keyword} pending`,
                    },
                    {
                        user_id: owner.userId,
                        category_id: owner.categoryId,
                        created_at: new Date(base + 1),
                        title: `${keyword} progress`,
                        status: 'in_progress',
                    },
                    {
                        user_id: owner.userId,
                        category_id: owner.categoryId,
                        created_at: new Date(base + 2),
                        title: `${keyword} done`,
                        status: 'completed',
                    },
                ])
                .execute();

            const all = await ctx.tvf('search_todos', {
                p_keyword: keyword,
                p_status: null,
            });

            const only = await ctx.tvf('search_todos', {
                p_keyword: keyword,
                p_status: 'completed',
            });

            expect(all.length).toBe(3);

            const statuses = new Set(all.map((r) => r.status));
            expect(statuses).toEqual(new Set(['pending', 'in_progress', 'completed']));

            expect(only.length).toBe(1);
            expect(only[0]!.status).toBe('completed');

        });

        test('list_users without p_include_deleted excludes soft-deleted rows', async () => {

            const aliveId = await (async () => {

                const row = await ctx.kysely
                    .insertInto('user')
                    .values({
                        username: uid('edge-null-alive'),
                        email: `${uid('edge-null-alive')}@example.test`,
                    })
                    .returning('id')
                    .executeTakeFirstOrThrow();

                return row.id;

            })();

            const deadId = await (async () => {

                const row = await ctx.kysely
                    .insertInto('user')
                    .values({
                        username: uid('edge-null-dead'),
                        email: `${uid('edge-null-dead')}@example.test`,
                    })
                    .returning('id')
                    .executeTakeFirstOrThrow();

                return row.id;

            })();

            userCleanup.push(aliveId, deadId);

            await ctx.tvf('soft_delete_user', { p_user_id: deadId });

            const defaultRows = await ctx.tvf('list_users', {});
            const includingDeleted = await ctx.tvf('list_users', {
                p_include_deleted: true,
            });

            const defaultIds = new Set(defaultRows.map((r) => r.id));
            const allIds = new Set(includingDeleted.map((r) => r.id));

            expect(defaultIds.has(aliveId)).toBe(true);
            expect(defaultIds.has(deadId)).toBe(false);
            expect(allIds.has(aliveId)).toBe(true);
            expect(allIds.has(deadId)).toBe(true);

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Custom RAISE codes surface with readable messages
    // ─────────────────────────────────────────────────────────────

    describe('stored-proc RAISE codes reach the caller intact', () => {

        test('complete_todo on missing todo raises P0002 "not found"', async () => {

            const call = ctx.tvf('complete_todo', {
                p_user_id: -1,
                p_category_id: -1,
                p_created_at: new Date(0),
            });

            await expect(call).rejects.toThrow(/not found/i);

        });

        test('complete_todo on already-completed todo raises P0001 "already completed"', async () => {

            const owner = await seedOwner(ctx, 'edge-p0001');
            userCleanup.push(owner.userId);
            categoryCleanup.push(owner.categoryId);

            const createdAt = new Date();

            await ctx.kysely
                .insertInto('todo')
                .values({
                    user_id: owner.userId,
                    category_id: owner.categoryId,
                    created_at: createdAt,
                    title: 'done already',
                    status: 'completed',
                })
                .execute();

            const call = ctx.tvf('complete_todo', {
                p_user_id: owner.userId,
                p_category_id: owner.categoryId,
                p_created_at: createdAt,
            });

            await expect(call).rejects.toThrow(/already completed/i);

        });

        test('bulk_create_tags with an empty array raises SQLSTATE 22023', async () => {

            const call = sql`
                SELECT * FROM bulk_create_tags(ARRAY[]::tag_input[])
            `.execute(ctx.kysely);

            await expect(call).rejects.toThrow(/empty/i);

        });

    });

});
