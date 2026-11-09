\pset pager off
CREATE TEMP TABLE expected_mode (mode text NOT NULL);
INSERT INTO expected_mode VALUES (:'mode');
SELECT id, slug, config_name, transaction_policy, status, transaction_outcome,
       finished_at IS NOT NULL AS settled, active_key IS NULL AS guard_released
FROM noorm.pipeline_run ORDER BY id;
SELECT pipeline_run_id, step_no, name, needs, status, transaction_outcome
FROM noorm.pipeline_step ORDER BY pipeline_run_id, step_no;
TABLE recording.period_cache;
TABLE recording.period_close;
DO $$
DECLARE
    mode text := (SELECT e.mode FROM expected_mode e);
    expected_runs integer;
BEGIN
    IF (SELECT count(*) FROM recording.invoice) <> 6
       OR (SELECT sum(amount) FROM recording.invoice) <> 720 THEN
        RAISE EXCEPTION 'Source invoices changed';
    END IF;
    expected_runs := CASE mode WHEN 'dry' THEN 0 WHEN 'run' THEN 1 ELSE 2 END;
    IF (SELECT count(*) FROM noorm.pipeline_run) <> expected_runs
       OR (SELECT count(*) FROM noorm.pipeline_step) <> expected_runs * 3
       OR EXISTS (SELECT FROM noorm.pipeline_run WHERE config_name <> 'dev'
           OR finished_at IS NULL OR active_key IS NOT NULL) THEN
        RAISE EXCEPTION 'Unexpected history, unsettled run, or unreleased guard';
    END IF;
    IF mode = 'dry' THEN
        IF EXISTS (SELECT FROM recording.period_cache) OR EXISTS (SELECT FROM recording.period_close) THEN
            RAISE EXCEPTION 'Dry run executed business SQL';
        END IF;
    ELSIF mode = 'run' THEN
        IF NOT EXISTS (SELECT FROM noorm.pipeline_run WHERE id = 1 AND slug = 'close-period'
            AND transaction_policy = 'pipeline' AND status = 'success' AND transaction_outcome = 'committed')
           OR EXISTS (SELECT FROM noorm.pipeline_step WHERE status <> 'success' OR transaction_outcome <> 'committed')
           OR (SELECT count(*) FROM recording.period_cache) <> 1
           OR NOT EXISTS (SELECT FROM recording.period_cache WHERE period = '2026-10'
               AND invoice_count = 2 AND total = 200 AND unpaid_count = 0)
           OR (SELECT count(*) FROM recording.period_close) <> 1
           OR NOT EXISTS (SELECT FROM recording.period_close WHERE period = '2026-10' AND total = 200) THEN
            RAISE EXCEPTION 'Successful close did not commit exactly the October business effects';
        END IF;
    ELSE
        IF NOT EXISTS (SELECT FROM noorm.pipeline_run WHERE id = 1 AND slug = 'close-period-step'
            AND transaction_policy = 'step' AND status = 'partial' AND transaction_outcome = 'partial')
           OR NOT EXISTS (SELECT FROM noorm.pipeline_run WHERE id = 2 AND slug = 'close-period'
            AND transaction_policy = 'pipeline' AND status = 'failed' AND transaction_outcome = 'rolled_back')
           OR (SELECT count(*) FROM recording.period_cache) <> 1
           OR NOT EXISTS (SELECT FROM recording.period_cache WHERE period = '2026-11'
               AND invoice_count = 2 AND total = 200 AND unpaid_count = 1)
           OR EXISTS (SELECT FROM recording.period_close) THEN
            RAISE EXCEPTION 'Expected November cache commit, December rollback, and no published closes';
        END IF;
        IF EXISTS (
            SELECT FROM noorm.pipeline_step
            WHERE status <> CASE step_no WHEN 1 THEN 'success' WHEN 2 THEN 'failed' ELSE 'skipped' END
               OR transaction_outcome <> CASE
                   WHEN step_no = 3 THEN 'not_started'
                   WHEN step_no = 1 AND pipeline_run_id = 1 THEN 'committed'
                   ELSE 'rolled_back' END
        ) THEN
            RAISE EXCEPTION 'History lost execution versus transaction outcome distinction';
        END IF;
    END IF;
    IF EXISTS (SELECT FROM noorm.pipeline_step
        WHERE name <> CASE step_no WHEN 1 THEN 'refresh-cache' WHEN 2 THEN 'validate-paid' ELSE 'publish-close' END
           OR needs <> CASE step_no WHEN 1 THEN '[]' WHEN 2 THEN '[1]' ELSE '[2]' END) THEN
        RAISE EXCEPTION 'Unexpected declaration identity or dependencies';
    END IF;
END;
$$;
SELECT 'Verified ' || mode || ': history and business invariants' AS verification FROM expected_mode;
