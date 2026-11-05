# SDK routines inside a transaction


## Problem


`ctx.transaction(fn)` hands `fn` a plain Kysely `Transaction<DB>`. `proc`, `func`, and `tvf` live only on `Context` and `ImpersonatedScope`, so a caller who needs a routine call inside a transaction drops to raw `sql` and loses the typed, dialect-aware call path.

The case that surfaced it (noormdev/noorm#106): a per-call Postgres `statement_timeout`. A function-level `SET statement_timeout` clause does not fire, because Postgres starts the timer with the calling statement. The working pattern is:

    BEGIN;
    SET LOCAL statement_timeout = '8s';
    SELECT * FROM get_graph_neighborhood_fn(...);
    COMMIT;

That needs the routine call on the transaction's connection.


## Approaches


| Approach | Wins | Loses |
|----------|------|-------|
| A. `proc`/`func`/`tvf` on the transaction handle | Composes with any transaction-scoped setting on any dialect (`SET LOCAL`, isolation level, advisory locks, writes rolled back together); non-breaking | Caller writes the `SET LOCAL` line |
| B. Per-call option, e.g. `{ statementTimeout: '8s' }` | One-liner for the timeout case | Postgres-only semantics; widens every routine signature with an options bag that collides with positional params; solves one setting, not the class |

**Chosen: A.** The issue lists both; A covers B's case in two lines and every other transaction-scoped need. B can be layered on A later if the timeout case proves common.


## Shape


The callback's `trx` stays a Kysely `Transaction<DB>` and gains `proc`, `func`, and `tvf`. Existing callbacks typed `(trx: Transaction<DB>) => …` still type-check, because a function that accepts the narrower `Transaction<DB>` accepts the intersection.

    await ctx.transaction(async (trx) => {

        await sql`SET LOCAL statement_timeout = '8s'`.execute(trx);

        return trx.tvf('get_graph_neighborhood_fn', { p_node_id: id });

    });

The routine methods are attached to the transaction instance Kysely creates for the call. Kysely's `Kysely`/`Transaction` classes keep state in `#props`, so a prototype-delegating wrapper (`Object.create(trx)`) would throw on every builder call; assigning the three methods onto the instance avoids that.

`ImpersonatedScope.transaction(fn)` gets the same handle, so the two transaction entry points match.


## Postgres `proc` fallback inside a transaction


`ctx.proc` on Postgres tries `CALL name(...)` and, on SQLSTATE 42809/42883 ("is a function, not a procedure"), retries as `SELECT * FROM name(...)`. Inside a transaction the failed `CALL` aborts the transaction, so the retry fails with 25P02 (`current transaction is aborted`).

When the executor is a transaction (`db.isTransaction`), `proc` asks the catalog first instead of trying `CALL`:

    SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prokind = 'p' AND p.proname = $name
          AND n.nspname = $schema                         -- qualified name
          -- or: AND n.nspname = ANY (current_schemas(false)) -- unqualified name
    )

`true` runs `CALL`, `false` runs `SELECT * FROM`. A function is never sent to `CALL` unless the same name is also a visible procedure, so calling a function does not abort the transaction. Outside a transaction nothing changes.

| Approach | Wins | Loses |
|----------|------|-------|
| Savepoint around `CALL`, `ROLLBACK TO` before the fallback | No extra round trip on the `CALL` path | `RELEASE`/`ROLLBACK TO` destroy later savepoints, so concurrent `trx.proc` calls break each other; a queue fixes that but not a sibling statement (`trx.insertInto`) that lands inside the savepoint window and is silently rolled back |
| **Catalog lookup** (chosen) | No failing `CALL` against a function, no savepoint window, safe under `Promise.all` | One extra round trip per `trx.proc` on Postgres |

Edge: when one name is both a FUNCTION and a PROCEDURE (overloads in one schema, or different schemas on `search_path`), the lookup returns true and `trx.proc` runs `CALL`. If `CALL` resolves to the function (a function earlier on `search_path`, or arguments matching the function overload), it fails with 42809 and aborts the transaction, where `ctx.proc` outside a transaction would fall back. The lookup matches on name, not arguments or `search_path` order; `trx.tvf` reaches the function in every case.


## Shared routine helpers


`Context`, `ImpersonatedScope`, and the transaction handle each need proc/func/tvf over a different executor. One module, `src/sdk/routines.ts`, holds the three executor-parameterised calls (including the Postgres fallback) and the function that attaches them to a transaction. Schema qualification (`qualifyName`) lives there too; `Context` passes its schema in, the scope passes none, as today.

Moving the scope's `proc` onto the shared helper gives it the Postgres function fallback it currently lacks. That is a behavior change on `ImpersonatedScope.proc` against a Postgres FUNCTION: an error today, rows after.
