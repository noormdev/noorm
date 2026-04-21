/**
 * End-to-end verification that seed templates under `sql/10_seeds/` were
 * applied by `db reset`.
 *
 * The build pipeline reads YAML side-files (`cron.yml`, `feature_flags.yml`)
 * into the Eta context, then renders `*.sql.tmpl` templates that emit INSERTs.
 * These tests assert the post-build database reflects exactly what the YAML
 * declared — catching regressions in: template rendering, YAML loading, the
 * seed ordering convention, and the vault-aware "missing secret → disabled"
 * path for feature flags.
 *
 * No seeds are inserted here — these tests read the rows that the shared
 * context build already created.
 */
import { beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext } from '../_helpers/setup.js';

describe('seeds/cron + feature_flags', () => {

    let ctx: TestContext;

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    test('cron_schedule table is populated with every schedule from cron.yml', async () => {

        const rows = await ctx.kysely
            .selectFrom('cron_schedule')
            .selectAll()
            .orderBy('name', 'asc')
            .execute();

        const names = rows.map((r) => r.name);

        expect(names).toEqual([
            'DailyAt3AM',
            'DailyAt4AM',
            'EveryHour',
            'MondayAt9AM',
            'MonthlyOn1stAt2AM',
        ]);

        const everyHour = rows.find((r) => r.name === 'EveryHour');
        expect(everyHour).toBeDefined();
        expect(everyHour!.every).toBe('Hours');
        expect(everyHour!.every_n).toBe(1);

        const weekly = rows.find((r) => r.name === 'MondayAt9AM');
        expect(weekly).toBeDefined();
        expect(weekly!.frequency).toBe('Weekly');
        expect(weekly!.interval).toBe('Monday');

    });

    test('cron_job table has one row per job declared in cron.yml', async () => {

        const rows = await ctx.kysely
            .selectFrom('cron_job')
            .select(['name', 'description', 'enabled'])
            .orderBy('name', 'asc')
            .execute();

        const names = rows.map((r) => r.name);

        expect(names).toEqual([
            'Expire_Overdue_Todos',
            'Prune_Completed_Todos',
            'Refresh_User_Stats',
        ]);

        // Each job carries a non-empty description.
        for (const row of rows) {

            expect(row.description.length).toBeGreaterThan(0);

        }

    });

    test('cron_job_schedule links each job to the schedule that runs it', async () => {

        const rows = await ctx.kysely
            .selectFrom('cron_job_schedule as js')
            .innerJoin('cron_job as j', 'j.id', 'js.job_id')
            .innerJoin('cron_schedule as s', 's.id', 'js.schedule_id')
            .select(['j.name as job_name', 's.name as schedule_name'])
            .execute();

        const links = new Set(rows.map((r) => `${r.schedule_name}→${r.job_name}`));

        expect(links.has('DailyAt3AM→Prune_Completed_Todos')).toBe(true);
        expect(links.has('DailyAt4AM→Refresh_User_Stats')).toBe(true);
        expect(links.has('EveryHour→Expire_Overdue_Todos')).toBe(true);

        // Schedules with empty `jobs: []` should have no link rows.
        expect(
            rows.some((r) => r.schedule_name === 'MondayAt9AM'),
        ).toBe(false);

    });

    test('feature_flag table reflects YAML + vault-aware enabled state', async () => {

        const rows = await ctx.kysely
            .selectFrom('feature_flag')
            .selectAll()
            .orderBy('name', 'asc')
            .execute();

        const byName = new Map(rows.map((r) => [r.name, r]));

        // All three flags from YAML are present.
        expect(byName.size).toBeGreaterThanOrEqual(3);
        expect(byName.has('experiments.new_ui')).toBe(true);
        expect(byName.has('integrations.sendgrid')).toBe(true);
        expect(byName.has('integrations.stripe')).toBe(true);

        // `experiments.new_ui` needs no secret — template leaves enabled=false
        // as declared.
        const newUi = byName.get('experiments.new_ui')!;
        expect(newUi.enabled).toBe(false);
        expect(newUi.config.rollout_pct).toBe(0);
        expect(newUi.config.requires_secret).toBeNull();

        // Secret-backed flags get forced off when the secret isn't present in
        // the test vault — the template's `!hasSecret → enabled=false` branch.
        const stripe = byName.get('integrations.stripe')!;
        expect(stripe.enabled).toBe(false);
        expect(stripe.config.token).toBeNull();
        expect(stripe.config.requires_secret).toBe('STRIPE_API_KEY');
        expect(stripe.config.webhook_endpoint).toBe('/webhooks/stripe');

    });

});
