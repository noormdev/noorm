/**
 * JSONB round-trip coverage for the `todo.metadata` column.
 *
 * The goal: prove the driver + Kysely + Postgres pipeline preserves structural
 * fidelity across insert/read/update/merge. JSONB is lossy in some drivers
 * (ordering, numeric precision, Date → ISO string), so each test pins one
 * specific contract the application code relies on.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'kysely';

import type { TestContext } from '../_helpers/context.js';
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

describe('tables/todo.metadata (JSONB) — round-trip + operators', () => {

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

    test('insert + select round-trips a deeply nested object verbatim', async () => {

        const owner = await seedOwner(ctx, 'jb-nested');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const createdAt = new Date();
        const metadata = {
            labels: ['alpha', 'beta', 'gamma'],
            nested: {
                level: 2,
                flags: { one: true, two: false },
                notes: ['pending review', null],
            },
            count: 42,
            ratio: 0.125,
        };

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: 'metadata carrier',
                metadata,
            })
            .execute();

        const row = await ctx.kysely
            .selectFrom('todo')
            .select('metadata')
            .where('user_id', '=', owner.userId)
            .where('category_id', '=', owner.categoryId)
            .where('created_at', '=', createdAt)
            .executeTakeFirstOrThrow();

        expect(row.metadata).toEqual(metadata);

    });

    test('empty object is a legal default and round-trips as {}', async () => {

        const owner = await seedOwner(ctx, 'jb-empty');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: 'defaulted',
            })
            .execute();

        const row = await ctx.kysely
            .selectFrom('todo')
            .select('metadata')
            .where('user_id', '=', owner.userId)
            .where('category_id', '=', owner.categoryId)
            .where('created_at', '=', createdAt)
            .executeTakeFirstOrThrow();

        expect(row.metadata).toEqual({});

    });

    test('JSONB ->> operator filters rows by a nested string field', async () => {

        const owner = await seedOwner(ctx, 'jb-filter');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const createdAtA = new Date(Date.now() - 200);
        const createdAtB = new Date(Date.now() - 100);

        await ctx.kysely
            .insertInto('todo')
            .values([
                {
                    user_id: owner.userId,
                    category_id: owner.categoryId,
                    created_at: createdAtA,
                    title: 'origin=api',
                    metadata: { origin: 'api', score: 1 },
                },
                {
                    user_id: owner.userId,
                    category_id: owner.categoryId,
                    created_at: createdAtB,
                    title: 'origin=cli',
                    metadata: { origin: 'cli', score: 2 },
                },
            ])
            .execute();

        // metadata->>'origin' extracts a TEXT field from JSONB. Kysely's
        // builder can't type raw JSONB operators, so go through sql``.
        const result = await sql<{ title: string; origin: string }>`
            SELECT title, metadata->>'origin' AS origin
            FROM todo
            WHERE user_id = ${owner.userId}
              AND metadata->>'origin' = ${'cli'}
        `.execute(ctx.kysely);

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]!.title).toBe('origin=cli');
        expect(result.rows[0]!.origin).toBe('cli');

    });

    test('JSONB || concatenation merges an update patch into existing metadata', async () => {

        const owner = await seedOwner(ctx, 'jb-merge');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: 'merge-me',
                metadata: { a: 1, b: 'keep' },
            })
            .execute();

        const patch = { b: 'replaced', c: [1, 2, 3] };

        await sql`
            UPDATE todo
            SET metadata = metadata || ${JSON.stringify(patch)}::jsonb
            WHERE user_id = ${owner.userId}
              AND category_id = ${owner.categoryId}
              AND created_at = ${createdAt}
        `.execute(ctx.kysely);

        const row = await ctx.kysely
            .selectFrom('todo')
            .select('metadata')
            .where('user_id', '=', owner.userId)
            .where('category_id', '=', owner.categoryId)
            .where('created_at', '=', createdAt)
            .executeTakeFirstOrThrow();

        expect(row.metadata).toEqual({ a: 1, b: 'replaced', c: [1, 2, 3] });

    });

});
