import { expect, it } from 'bun:test';

it('should record SQLite pipeline history in UTC under a non-UTC process timezone', async () => {

    const sqliteModule = new URL('../../../src/core/connection/dialects/sqlite-bun.ts', import.meta.url).href;
    const historyModule = new URL('../../../src/core/pipeline/history.ts', import.meta.url).href;
    const schemaModule = new URL('../../../src/core/version/schema/index.ts', import.meta.url).href;
    const script = `
        import { Kysely, SqliteDialect } from 'kysely';
        import { BunSqliteDatabase } from ${JSON.stringify(sqliteModule)};
        import { createPipelineIntent, finalizePipelineRun, getPipelineRun, listPipelineHistory }
            from ${JSON.stringify(historyModule)};
        import { bootstrapSchema } from ${JSON.stringify(schemaModule)};

        const db = new Kysely({
            dialect: new SqliteDialect({ database: new BunSqliteDatabase(':memory:') }),
        });
        try {
            await bootstrapSchema(db, 'sqlite');
            const context = {
                db, dialect: 'sqlite', configName: 'alpha',
                executedBy: 'operator@example.test', cliVersion: 'test-version',
            };
            const before = Date.now();
            const id = await createPipelineIntent(context, {
                slug: 'timezone', manifestChecksum: 'a'.repeat(64), transaction: 'pipeline',
                singleRun: false,
                steps: [{ stepNo: 1, name: 'first', filepath: 'first.sql', checksum: 'b'.repeat(64), needs: [] }],
            });
            const after = Date.now();
            const pending = await getPipelineRun(context, id);
            const startedAt = new Date('2026-01-02T03:04:05.123Z');
            const finishedAt = new Date('2026-01-02T03:04:06.456Z');
            await finalizePipelineRun(context, id, {
                run: {
                    status: 'success', transaction_outcome: 'committed',
                    started_at: startedAt, finished_at: finishedAt, duration_ms: 1333,
                },
                steps: [{
                    step_no: 1, status: 'success', transaction_outcome: 'committed',
                    started_at: startedAt, finished_at: finishedAt, duration_ms: 1333,
                }],
            });
            const result = await getPipelineRun(context, id);
            const history = await listPipelineHistory(context, 'timezone');
            console.log(JSON.stringify({
                offset: new Date('2026-01-02T03:04:05Z').getTimezoneOffset(),
                before, after, pending, result, history,
            }));
        }
        finally {
            await db.destroy();
        }
    `;
    const child = Bun.spawn([process.execPath, '-e', script], {
        cwd: new URL('../../..', import.meta.url).pathname,
        env: { ...process.env, TZ: 'Pacific/Honolulu' },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
    const data = JSON.parse(stdout) as {
        offset: number;
        before: number;
        after: number;
        pending: { run: { created_at: string } };
        result: { run: { created_at: string; started_at: string; finished_at: string }; steps: {
            started_at: string; finished_at: string;
        }[] };
        history: { created_at: string }[];
    };
    expect(data.offset).toBe(600);
    const created = Date.parse(data.pending.run.created_at);
    expect(created).toBeGreaterThanOrEqual(data.before - 1000);
    expect(created).toBeLessThanOrEqual(data.after);
    expect(data.result.run.created_at).toBe(data.pending.run.created_at);
    expect(data.history[0]?.created_at).toBe(data.pending.run.created_at);
    expect(data.result.run.started_at).toBe('2026-01-02T03:04:05.123Z');
    expect(data.result.run.finished_at).toBe('2026-01-02T03:04:06.456Z');
    expect(data.result.steps).toHaveLength(1);
    expect(data.result.steps[0]?.started_at).toBe('2026-01-02T03:04:05.123Z');
    expect(data.result.steps[0]?.finished_at).toBe('2026-01-02T03:04:06.456Z');

});
