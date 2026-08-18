-- Rows for the recordings that show data rather than schema (05-rows.tape).
--
-- Deliberately NOT under sql/: `noorm run build` globs that directory, and a
-- seed file there would turn the 4-file schema every other tape narrates into
-- a 5-file one. sandbox.sh pipes this straight to psql instead, so only the
-- `seeded` mode ever sees it.
--
-- 24 tasks is chosen, not arbitrary. The row peek shows First N and Last N as
-- two tables only when the table holds more rows than it can read at both ends;
-- a handful of rows collapses to a single "All N rows" table and the recording
-- stops demonstrating the thing it exists to demonstrate.

INSERT INTO app_user (email, created_at) VALUES
    ('ada@example.com',     TIMESTAMPTZ '2026-01-04 09:15:00+00'),
    ('grace@example.com',   TIMESTAMPTZ '2026-01-11 16:40:00+00'),
    ('alan@example.com',    TIMESTAMPTZ '2026-02-02 08:05:00+00');

INSERT INTO project (user_id, created_at, name) VALUES
    (1, TIMESTAMPTZ '2026-01-04 09:30:00+00', 'Billing rewrite'),
    (2, TIMESTAMPTZ '2026-01-12 10:00:00+00', 'Search relevance'),
    (3, TIMESTAMPTZ '2026-02-02 08:20:00+00', 'Onboarding funnel');

INSERT INTO task (user_id, created_at, task_index, title, done, priority) VALUES
    (1, TIMESTAMPTZ '2026-01-04 09:30:00+00', 1, 'Model invoices with an inherited key',   true,  1),
    (1, TIMESTAMPTZ '2026-01-04 09:30:00+00', 2, 'Backfill legacy invoice numbers',        true,  2),
    (1, TIMESTAMPTZ '2026-01-04 09:30:00+00', 3, 'Split tax lines onto their own table',   true,  2),
    (1, TIMESTAMPTZ '2026-01-04 09:30:00+00', 4, 'Reconcile refunds against payments',     false, 1),
    (1, TIMESTAMPTZ '2026-01-04 09:30:00+00', 5, 'Retire the surrogate invoice_id',        false, 3),
    (1, TIMESTAMPTZ '2026-01-04 09:30:00+00', 6, 'Add a dunning schedule',                 false, 4),
    (1, TIMESTAMPTZ '2026-01-04 09:30:00+00', 7, 'Export monthly revenue to the warehouse', false, 3),
    (1, TIMESTAMPTZ '2026-01-04 09:30:00+00', 8, 'Document the currency rounding rule',    false, 5),

    (2, TIMESTAMPTZ '2026-01-12 10:00:00+00', 1, 'Tokenise product titles',                true,  2),
    (2, TIMESTAMPTZ '2026-01-12 10:00:00+00', 2, 'Weight recent purchases higher',         true,  1),
    (2, TIMESTAMPTZ '2026-01-12 10:00:00+00', 3, 'Drop the stopword list',                 true,  4),
    (2, TIMESTAMPTZ '2026-01-12 10:00:00+00', 4, 'Measure click-through per query',        false, 2),
    (2, TIMESTAMPTZ '2026-01-12 10:00:00+00', 5, 'Cache the top thousand queries',         false, 3),
    (2, TIMESTAMPTZ '2026-01-12 10:00:00+00', 6, 'Handle plural and singular forms',       false, 3),
    (2, TIMESTAMPTZ '2026-01-12 10:00:00+00', 7, 'Rank exact matches above fuzzy ones',    false, 2),
    (2, TIMESTAMPTZ '2026-01-12 10:00:00+00', 8, 'Log every empty result set',             false, 5),

    (3, TIMESTAMPTZ '2026-02-02 08:20:00+00', 1, 'Cut the signup form to three fields',    true,  1),
    (3, TIMESTAMPTZ '2026-02-02 08:20:00+00', 2, 'Verify email before first login',        true,  1),
    (3, TIMESTAMPTZ '2026-02-02 08:20:00+00', 3, 'Send a welcome message on day one',      true,  3),
    (3, TIMESTAMPTZ '2026-02-02 08:20:00+00', 4, 'Track drop-off between step two and three', false, 2),
    (3, TIMESTAMPTZ '2026-02-02 08:20:00+00', 5, 'Offer a sample project on first run',    false, 2),
    (3, TIMESTAMPTZ '2026-02-02 08:20:00+00', 6, 'Remind dormant accounts after a week',   false, 4),
    (3, TIMESTAMPTZ '2026-02-02 08:20:00+00', 7, 'Translate the checklist into Spanish',   false, 4),
    (3, TIMESTAMPTZ '2026-02-02 08:20:00+00', 8, 'Retire the old onboarding modal',        false, 5);
