/**
 * Coverage for the `bulk_create_tags` TVF — Postgres' closest analog to a
 * table-valued parameter.
 *
 * The function takes a `tag_input[]` (array-of-composite) and upserts each
 * row: existing names get their color refreshed, new names get inserted.
 * Returns one row per input with a `was_inserted` boolean derived from
 * `xmax = 0` (PG's "this tuple is fresh in this txn" signal).
 *
 * The SDK's `ctx.tvf` path serializes objects as JSON, which isn't the
 * composite-record format PG expects. So these tests drive the call via
 * Kysely's raw `sql` template with parameterized `(name, color)::tag_input`
 * tuples — exactly how an application would invoke a composite-input TVF.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'kysely';

import type { TestContext } from '../_helpers/context.js';
import type { BulkCreateTagRow } from '../_helpers/schema.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

interface TagInput {
    name: string;
    color: string;
}

async function callBulkCreate(ctx: TestContext, rows: TagInput[]): Promise<BulkCreateTagRow[]> {

    const tuples = sql.join(
        rows.map((r) => sql`(${r.name}, ${r.color})::tag_input`),
    );

    const result = await sql<BulkCreateTagRow>`
        SELECT * FROM bulk_create_tags(ARRAY[${tuples}]::tag_input[])
    `.execute(ctx.kysely);

    return result.rows;

}

describe('functions/bulk_create_tags — array-of-composite TVP', () => {

    let ctx: TestContext;
    const tagCleanup: number[] = [];

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    afterAll(async () => {

        if (tagCleanup.length > 0) {

            await ctx.kysely
                .deleteFrom('tag')
                .where('id', 'in', tagCleanup)
                .execute();

        }

    });

    test('inserts fresh rows and flags every one with was_inserted=true', async () => {

        const names = [uid('bc-alpha'), uid('bc-bravo'), uid('bc-charlie')];
        const input: TagInput[] = [
            { name: names[0]!, color: '#ff0000' },
            { name: names[1]!, color: '#00ff00' },
            { name: names[2]!, color: '#0000ff' },
        ];

        const rows = await callBulkCreate(ctx, input);

        for (const r of rows) {

            tagCleanup.push(r.id);

        }

        expect(rows).toHaveLength(3);
        expect(rows.every((r) => r.was_inserted)).toBe(true);
        expect(rows.map((r) => r.name)).toEqual([...names].sort());

        const byName = new Map(rows.map((r) => [r.name, r]));
        expect(byName.get(names[0]!)!.color).toBe('#ff0000');
        expect(byName.get(names[1]!)!.color).toBe('#00ff00');
        expect(byName.get(names[2]!)!.color).toBe('#0000ff');

    });

    test('re-upsert refreshes color + reports was_inserted=false for existing rows', async () => {

        const existingName = uid('bc-exist');
        const existing = await ctx.kysely
            .insertInto('tag')
            .values({ name: existingName, color: '#aaaaaa' })
            .returning('id')
            .executeTakeFirstOrThrow();
        tagCleanup.push(existing.id);

        const newName = uid('bc-new');

        const rows = await callBulkCreate(ctx, [
            { name: existingName, color: '#112233' },
            { name: newName, color: '#445566' },
        ]);

        for (const r of rows) {

            if (r.id !== existing.id) tagCleanup.push(r.id);

        }

        const byName = new Map(rows.map((r) => [r.name, r]));
        const existingRow = byName.get(existingName)!;
        const newRow = byName.get(newName)!;

        expect(existingRow.was_inserted).toBe(false);
        expect(existingRow.color).toBe('#112233');
        expect(existingRow.id).toBe(existing.id);

        expect(newRow.was_inserted).toBe(true);
        expect(newRow.color).toBe('#445566');

    });

    test('empty color falls back to the default #808080', async () => {

        const name = uid('bc-default');

        const rows = await callBulkCreate(ctx, [{ name, color: '' }]);

        for (const r of rows) {

            tagCleanup.push(r.id);

        }

        expect(rows).toHaveLength(1);
        expect(rows[0]!.color).toBe('#808080');

    });

    test('raises when the input array is empty', async () => {

        const call = sql`SELECT * FROM bulk_create_tags(ARRAY[]::tag_input[])`.execute(ctx.kysely);

        await expect(call).rejects.toThrow(/bulk_create_tags: input array is empty/i);

    });

});
