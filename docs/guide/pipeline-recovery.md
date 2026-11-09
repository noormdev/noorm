# Recover an abandoned pipeline guard

Recover a protected pipeline only after its originating worker is stopped and every workflow session and transaction has settled. If you cannot prove that, **leave the key in place**. Clearing it while SQL or rollback is still running can allow overlapping business work.

Use this administrator procedure when a `singleRun` pipeline remains busy after its worker has stopped. There is no TTL, automatic steal, or force-unlock API. Pipeline history buffers execution outcomes and does not contain physical session IDs. A `pending` record is not proof that a step never ran.

## Errors that leave an unknown outcome

In `pipeline` and `step` modes noorm checks, after each step and before it rolls back, that the managed transaction is still the one it opened. Two error codes report a failed check. The SDK returns them in a result's `primaryError`, `secondaryErrors` and step `error`. With `--json`, the CLI keeps only `phase` and `stepNo` of each error. Text output shows the run ID, statuses and transaction outcomes, but no errors.

| Code | Phase | Meaning | Guard |
|---|---|---|---|
| `TRANSACTION_ESCAPED` | `execute` | The step ended or replaced the managed transaction, for example through SQL the preflight could not recognize. The step is `failed` with an `unknown` transaction outcome | Not retained by this check alone; unsettled work still retains it |
| `OWNERSHIP_UNVERIFIED` | `cleanup` | noorm could not verify that it still owned the transaction, so it cannot say what committed or rolled back. The outcome is `unknown` | Retained. A SQLite run releases it once a probe shows no transaction is open on the session, and the outcome stays `unknown` |

An `unknown` outcome does not tell you which writes persisted. Inspect the business tables before rerunning. If the guard is retained, follow the procedure on this page.

## Identify and stop the owner

1. Stop and fence the originating process, job, scheduler, and any automatic restarts. Keep them stopped throughout recovery. Identify the target database or SQLite file, resolved config name, slug, run ID, and full 64-character `active_key`. Use [`noorm pipeline history` and `noorm pipeline show`](/cli/pipeline) to find the run; the CLI omits the key, so read it from the appropriate run table below using an administrator connection. Treat the key as an exact value, not an abbreviated checksum.
2. Independently identify **every** physical workflow session belonging to that invocation using deployment records, process and connection telemetry, server logs, and connection details. A pipeline owns a private workflow pool and can use multiple sessions; the caller's connection and bookkeeping connection are not that pool. Session IDs are not recorded in pipeline history. If attribution is uncertain, stop here and retain the key.
3. With an account authorized to inspect all relevant sessions and transactions, use the applicable inspection below. Wait for each identified session to finish, or terminate only a session whose identity you have verified. A canceled query, a missing active request, or a termination request alone does not prove rollback is complete. Confirm termination and rollback completion, including idle transactions, before continuing. Check prepared or distributed transactions separately if the environment permits them. Managed services may restrict inspection or termination; use their administrator controls or leave the key.
4. Connect to the same database with permission to read and update the noorm history tables. Run the matching reconciliation in one dedicated client connection. Preserve your incident evidence and resume the scheduler only after the transaction commits successfully.

The schema-v3 tables are `noorm.pipeline_run` and `noorm.pipeline_step` on PostgreSQL and SQL Server, and `__noorm_pipeline_run__` and `__noorm_pipeline_step__` on MySQL and SQLite. `active_key` is nullable `varchar(64)`. The `config_name` and `slug` select the same ownership scope as the run. On the correct database, inspect the run table for the exact ID and key before supplying them to the reconciliation. Restrict access to this output.

## Inspect the workflow sessions

These are inspection queries, not session attribution rules. The examples show a numeric session ID of `12345` for the optional termination command; replace it only with an independently verified ID. Do not terminate all sessions in a database. Rerun inspection outside a long-lived monitoring transaction so the view is current.

### PostgreSQL

Connect to the target database. Include `idle in transaction` and `idle in transaction (aborted)`, not only active queries. The query and client details may require `pg_read_all_stats` or equivalent privileges.

```sql
SELECT pid, datname, usename, application_name, client_addr, client_port,
       backend_start, state, xact_start, query_start, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
ORDER BY backend_start;

SELECT gid, prepared, owner, database FROM pg_prepared_xacts
WHERE database = current_database();
```

If necessary, terminate a verified backend with `SELECT pg_terminate_backend(12345);`. Reinspect until it is gone and any relevant transaction or prepared transaction has been resolved. Do not resolve a prepared transaction without identifying its owner and outcome.

### MySQL

Connect to the target server with `PROCESS` and InnoDB transaction visibility. `Sleep` connections can still own a transaction. A session may have changed its default database, so correlate all rows, not only rows showing the target database.

```sql
SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO
FROM information_schema.PROCESSLIST ORDER BY ID;

SELECT trx_id, trx_state, trx_started, trx_mysql_thread_id, trx_query
FROM information_schema.INNODB_TRX ORDER BY trx_started;
```

If necessary, issue `KILL CONNECTION 12345;` for a verified processlist ID. Wait for the connection and its transaction to disappear and for rollback to finish; inspect the InnoDB transaction list and server diagnostics. `KILL QUERY` is insufficient. If the workflow can use XA transactions, independently inspect and resolve those using your transaction manager.

### SQL Server

Connect with the server permissions required for the DMVs (including `VIEW SERVER STATE` or the version-appropriate performance-state permission). The left joins retain sleeping sessions without active requests; inspect the transaction rows as well.

```sql
SELECT s.session_id, s.login_name, s.host_name, s.program_name, s.status,
       s.login_time, s.open_transaction_count, r.status AS request_status,
       r.command, r.database_id, r.wait_type,
       st.transaction_id, at.transaction_begin_time, at.transaction_state,
       dt.database_id AS transaction_database_id
FROM sys.dm_exec_sessions AS s
LEFT JOIN sys.dm_exec_requests AS r ON r.session_id = s.session_id
LEFT JOIN sys.dm_tran_session_transactions AS st ON st.session_id = s.session_id
LEFT JOIN sys.dm_tran_active_transactions AS at ON at.transaction_id = st.transaction_id
LEFT JOIN sys.dm_tran_database_transactions AS dt ON dt.transaction_id = st.transaction_id
WHERE s.is_user_process = 1 AND s.session_id <> @@SPID
ORDER BY s.session_id;
```

For a verified session, `KILL 12345;` requests termination. While rollback is underway, `KILL 12345 WITH STATUSONLY;` reports progress. Reinspect the DMVs and wait until rollback has finished and the identified session and transactions have settled. Do not repeat `KILL` blindly: session IDs can be reused. Investigate distributed transactions independently.

### SQLite

SQLite has no server session catalog. Identify the exact file and all processes and handles that can access it using operating-system process and open-file inspection. Stop the originating worker and close its handles; fence other processes that can restart it. Wait for their operations to end. Do not infer quiescence merely from a lack of an active query. If handles or processes cannot be accounted for, retain the key.

For a file database, open the existing file with the SQLite CLI in read-write, no-create mode, for example `sqlite3 'file:./app.sqlite?mode=rw'`, using the verified path. The reconciliation uses `BEGIN IMMEDIATE` to acquire the file's writer lock. Failure to acquire it is a stop condition, not permission to delete lock files. A lock alone does not prove that an unidentified reader or process cannot later write. An in-memory database cannot be recovered through a separate connection; if its handle is gone, its contents are gone.

## Reconcile one run

The following examples use run ID `42`, config `production`, slug `refresh-reporting`, and a 64-character example key. Replace **all four** values with the independently verified values from the target database. Use the client shown and keep the same connection for the entire transaction. The markers delimit the executable reconciliation blocks.

Each block locks and displays the matching run, converts unresolved `pending` or `running` statuses to `unknown`, converts only `pending` transaction outcomes to `unknown`, and clears only the matching key. It preserves terminal statuses, known outcomes, timestamps, durations, errors, and skip reasons. A pending step might have executed before the buffered audit was flushed, so it is not automatically marked skipped. If independent evidence proves more, investigate and record that evidence separately; do not invent start, finish, or duration values. A recovery time is not the workflow finish time.

**Interactive safety check:** after the first `SELECT`, require exactly one row and verify its ID, config, slug and full key before continuing. Zero or multiple rows means `ROLLBACK;` and stop. After the final key update, require exactly one affected row. If any statement fails, the connection drops, or the affected count is not exactly one, execute `ROLLBACK;` if connected and investigate. Only after all checks succeed, issue `COMMIT;` in that same connection. Do not paste an unconditional `COMMIT` with the block. The guarded predicates also prevent a wrong key from changing the run or its steps.

### PostgreSQL reconciliation (`psql`)

```sql
-- recovery-postgres-begin
\set run_id 42
\set config_name 'production'
\set slug 'refresh-reporting'
\set active_key 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
BEGIN;
SELECT id, config_name, slug, active_key, status, transaction_outcome
FROM noorm.pipeline_run
WHERE id = :run_id AND config_name = :'config_name' AND slug = :'slug'
  AND active_key = :'active_key' AND length(:'active_key') = 64
FOR UPDATE;
-- Stop here and verify exactly one matching row before continuing.
UPDATE noorm.pipeline_step
SET status = CASE WHEN status IN ('pending', 'running') THEN 'unknown' ELSE status END,
    transaction_outcome = CASE WHEN transaction_outcome = 'pending' THEN 'unknown' ELSE transaction_outcome END
WHERE pipeline_run_id = :run_id
  AND EXISTS (SELECT 1 FROM noorm.pipeline_run
              WHERE id = :run_id AND config_name = :'config_name' AND slug = :'slug'
                AND active_key = :'active_key' AND length(:'active_key') = 64);
UPDATE noorm.pipeline_run
SET status = CASE WHEN status IN ('pending', 'running') THEN 'unknown' ELSE status END,
    transaction_outcome = CASE WHEN transaction_outcome = 'pending' THEN 'unknown' ELSE transaction_outcome END
WHERE id = :run_id AND config_name = :'config_name' AND slug = :'slug'
  AND active_key = :'active_key' AND length(:'active_key') = 64;
UPDATE noorm.pipeline_run SET active_key = NULL
WHERE id = :run_id AND config_name = :'config_name' AND slug = :'slug'
  AND active_key = :'active_key' AND length(:'active_key') = 64;
-- recovery-postgres-end
```

The last command must report `UPDATE 1`. A PostgreSQL error aborts the transaction; issue `ROLLBACK;` before retrying.

### MySQL reconciliation (`mysql`)

Use InnoDB history tables so `FOR UPDATE` and rollback provide transactional protection. The binary comparison requires the exact key even under a case-insensitive database collation.

```sql
-- recovery-mysql-begin
SET @run_id = 42, @config_name = 'production', @slug = 'refresh-reporting',
    @active_key = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
START TRANSACTION;
SELECT id, config_name, slug, active_key, status, transaction_outcome
FROM __noorm_pipeline_run__
WHERE id = @run_id AND config_name = @config_name AND slug = @slug
  AND BINARY active_key = BINARY @active_key AND LENGTH(@active_key) = 64
FOR UPDATE;
-- Stop here and verify exactly one matching row before continuing.
UPDATE __noorm_pipeline_step__
SET status = CASE WHEN status IN ('pending', 'running') THEN 'unknown' ELSE status END,
    transaction_outcome = CASE WHEN transaction_outcome = 'pending' THEN 'unknown' ELSE transaction_outcome END
WHERE pipeline_run_id = @run_id
  AND EXISTS (SELECT 1 FROM __noorm_pipeline_run__
              WHERE id = @run_id AND config_name = @config_name AND slug = @slug
                AND BINARY active_key = BINARY @active_key AND LENGTH(@active_key) = 64);
UPDATE __noorm_pipeline_run__
SET status = CASE WHEN status IN ('pending', 'running') THEN 'unknown' ELSE status END,
    transaction_outcome = CASE WHEN transaction_outcome = 'pending' THEN 'unknown' ELSE transaction_outcome END
WHERE id = @run_id AND config_name = @config_name AND slug = @slug
  AND BINARY active_key = BINARY @active_key AND LENGTH(@active_key) = 64;
UPDATE __noorm_pipeline_run__ SET active_key = NULL
WHERE id = @run_id AND config_name = @config_name AND slug = @slug
  AND BINARY active_key = BINARY @active_key AND LENGTH(@active_key) = 64;
SELECT ROW_COUNT() AS released_rows;
-- recovery-mysql-end
```

Require `released_rows = 1`, then choose `COMMIT;` or `ROLLBACK;` as instructed above. Do not run other statements between the last update and `ROW_COUNT()`.

### SQL Server reconciliation (`sqlcmd` or SSMS)

Run the block in two batches on a dedicated connection as described below. The update lock and serializable hold lock protect the owner row until the transaction ends. Unicode config names and slugs require `nvarchar` declarations and `N'…'` literals; the full 64-character key remains ASCII. The binary collation makes the key comparison exact. The `SET` preamble supplies the session options required to update a table with the filtered active-key index, including when using `sqlcmd`.

```sql
-- recovery-mssql-begin
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
DECLARE @run_id int = 42, @config_name nvarchar(255) = N'production',
        @slug nvarchar(255) = N'refresh-reporting',
        @active_key varchar(8000) = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
BEGIN TRANSACTION;
SELECT id, config_name, slug, active_key, status, transaction_outcome
FROM noorm.pipeline_run WITH (UPDLOCK, HOLDLOCK)
WHERE id = @run_id AND config_name = @config_name AND slug = @slug
  AND active_key COLLATE Latin1_General_100_BIN2 = @active_key COLLATE Latin1_General_100_BIN2
  AND DATALENGTH(@active_key) = 64;
-- Stop here and verify exactly one matching row before continuing in a second batch.
GO
DECLARE @run_id int = 42, @config_name nvarchar(255) = N'production',
        @slug nvarchar(255) = N'refresh-reporting',
        @active_key varchar(8000) = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
UPDATE noorm.pipeline_step
SET status = CASE WHEN status IN ('pending', 'running') THEN 'unknown' ELSE status END,
    transaction_outcome = CASE WHEN transaction_outcome = 'pending' THEN 'unknown' ELSE transaction_outcome END
WHERE pipeline_run_id = @run_id
  AND EXISTS (SELECT 1 FROM noorm.pipeline_run
              WHERE id = @run_id AND config_name = @config_name AND slug = @slug
                AND active_key COLLATE Latin1_General_100_BIN2 = @active_key COLLATE Latin1_General_100_BIN2
                AND DATALENGTH(@active_key) = 64);
UPDATE noorm.pipeline_run
SET status = CASE WHEN status IN ('pending', 'running') THEN 'unknown' ELSE status END,
    transaction_outcome = CASE WHEN transaction_outcome = 'pending' THEN 'unknown' ELSE transaction_outcome END
WHERE id = @run_id AND config_name = @config_name AND slug = @slug
  AND active_key COLLATE Latin1_General_100_BIN2 = @active_key COLLATE Latin1_General_100_BIN2
  AND DATALENGTH(@active_key) = 64;
UPDATE noorm.pipeline_run SET active_key = NULL
WHERE id = @run_id AND config_name = @config_name AND slug = @slug
  AND active_key COLLATE Latin1_General_100_BIN2 = @active_key COLLATE Latin1_General_100_BIN2
  AND DATALENGTH(@active_key) = 64;
SELECT @@ROWCOUNT AS released_rows;
-- recovery-mssql-end
```

A batch cannot pause for interactive verification halfway through. Run only the first batch, through `GO`, then inspect the row before submitting the second batch. Both batches must use identical declarations and values on the same connection. The session options, transaction, and lock persist across batches. On any error issue `ROLLBACK TRANSACTION;`; after `released_rows = 1`, issue `COMMIT TRANSACTION;`. Never start inside an existing transaction.

### SQLite reconciliation (`sqlite3`)

```sql
-- recovery-sqlite-begin
.parameter init
.parameter set :run_id 42
.parameter set :config_name "'production'"
.parameter set :slug "'refresh-reporting'"
.parameter set :active_key "'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"
BEGIN IMMEDIATE;
SELECT id, config_name, slug, active_key, status, transaction_outcome
FROM __noorm_pipeline_run__
WHERE id = :run_id AND config_name = :config_name AND slug = :slug
  AND active_key = :active_key COLLATE BINARY AND length(:active_key) = 64;
-- Stop here and verify exactly one matching row before continuing.
UPDATE __noorm_pipeline_step__
SET status = CASE WHEN status IN ('pending', 'running') THEN 'unknown' ELSE status END,
    transaction_outcome = CASE WHEN transaction_outcome = 'pending' THEN 'unknown' ELSE transaction_outcome END
WHERE pipeline_run_id = :run_id
  AND EXISTS (SELECT 1 FROM __noorm_pipeline_run__
              WHERE id = :run_id AND config_name = :config_name AND slug = :slug
                AND active_key = :active_key COLLATE BINARY AND length(:active_key) = 64);
UPDATE __noorm_pipeline_run__
SET status = CASE WHEN status IN ('pending', 'running') THEN 'unknown' ELSE status END,
    transaction_outcome = CASE WHEN transaction_outcome = 'pending' THEN 'unknown' ELSE transaction_outcome END
WHERE id = :run_id AND config_name = :config_name AND slug = :slug
  AND active_key = :active_key COLLATE BINARY AND length(:active_key) = 64;
UPDATE __noorm_pipeline_run__ SET active_key = NULL
WHERE id = :run_id AND config_name = :config_name AND slug = :slug
  AND active_key = :active_key COLLATE BINARY AND length(:active_key) = 64;
SELECT changes() AS released_rows;
-- recovery-sqlite-end
```

Require `released_rows = 1`, then choose `COMMIT;` or `ROLLBACK;` as instructed above. Run `changes()` immediately after the last update. If `BEGIN IMMEDIATE` fails, do not continue.

For normal pipeline behavior, see the [pipeline guide](/guide/sql-pipelines). For commands and history output, see the [pipeline CLI reference](/cli/pipeline).

Database references: [PostgreSQL monitoring](https://www.postgresql.org/docs/16/monitoring-stats.html), [PostgreSQL administration functions](https://www.postgresql.org/docs/16/functions-admin.html), [MySQL process information](https://dev.mysql.com/doc/refman/8.0/en/processlist-access.html), [MySQL KILL](https://dev.mysql.com/doc/refman/8.0/en/kill.html), [SQL Server KILL](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/kill-transact-sql), and [SQLite transactions](https://www.sqlite.org/lang_transaction.html).
