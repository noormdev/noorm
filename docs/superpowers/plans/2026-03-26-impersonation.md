# Per-Request User Impersonation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `impersonate()` method to the SDK Context class that borrows a dedicated pool connection, switches database identity via dialect-specific SQL, and exposes a scoped query interface with guaranteed revert.

**Architecture:** The impersonation system has three layers: a dialect strategy map that produces the SQL strings, a scope builder that wires `proc`/`func`/`transaction`/`kysely` to a dedicated connection, and the `impersonate()` method on Context that orchestrates the connection lifecycle using Kysely's `.connection()` API with a deferred-promise pattern for the explicit mode.

**Tech Stack:** Kysely (connection management, sql template), bun:test (testing), @logosdx/utils (attempt)

**Spec:** `docs/superpowers/specs/2026-03-26-impersonation-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/sdk/impersonate/types.ts` | Create | `ImpersonatedScope` interface, `ImpersonationError` class |
| `src/sdk/impersonate/dialect-strategy.ts` | Create | Dialect strategy map — impersonate/revert SQL per dialect, username validation |
| `src/sdk/impersonate/scope.ts` | Create | `buildScope()` — constructs the scoped interface wired to a dedicated connection |
| `src/sdk/impersonate/index.ts` | Create | Barrel export |
| `src/sdk/context.ts` | Modify | Add `impersonate()` method with both overloads |
| `src/sdk/index.ts` | Modify | Re-export `ImpersonatedScope` type and `ImpersonationError` |
| `tests/sdk/impersonate/dialect-strategy.test.ts` | Create | Dialect SQL generation + username validation tests |
| `tests/sdk/impersonate/scope.test.ts` | Create | Scope wiring + revert idempotency tests |
| `tests/sdk/impersonate/impersonate.test.ts` | Create | Full impersonate() lifecycle tests (callback + explicit modes) |

---

## Task 1: ImpersonatedScope Type and ImpersonationError

**Files:**
- Create: `src/sdk/impersonate/types.ts`
- Create: `src/sdk/impersonate/index.ts`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * Impersonation types.
 *
 * Defines the scoped interface returned by ctx.impersonate() and
 * the error class for unsupported dialects / invalid usernames.
 */
import type { Kysely, Transaction } from 'kysely';

// ─────────────────────────────────────────────────────────────
// ImpersonatedScope
// ─────────────────────────────────────────────────────────────

/**
 * Scoped query interface bound to a dedicated impersonated connection.
 *
 * All queries route through a single pool connection running under
 * the impersonated principal. Mirrors Context's query surface without
 * lifecycle or noorm ops.
 */
export interface ImpersonatedScope<DB = unknown, Procs = object, Funcs = object> {
    kysely: Kysely<DB>;
    proc: <T = unknown, N extends keyof Procs & string = keyof Procs & string>(
        name: N,
        ...args: Procs[N] extends void ? [] : [params: Procs[N]]
    ) => Promise<T[]>;
    func: <T = unknown, N extends keyof Funcs & string = keyof Funcs & string>(
        name: N,
        ...args: Funcs[N] extends void ? [column: string] : [params: Funcs[N], column: string]
    ) => Promise<T>;
    transaction: <T>(fn: (trx: Transaction<DB>) => Promise<T>) => Promise<T>;
    revert: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// ImpersonationError
// ─────────────────────────────────────────────────────────────

/**
 * Thrown when impersonation fails.
 *
 * Covers unsupported dialects and invalid usernames.
 */
export class ImpersonationError extends Error {

    constructor(message: string) {

        super(message);
        this.name = 'ImpersonationError';

    }

}
```

- [ ] **Step 2: Create barrel export**

```typescript
/**
 * Impersonation module.
 */
export { ImpersonationError } from './types.js';
export type { ImpersonatedScope } from './types.js';
export { dialectStrategy } from './dialect-strategy.js';
export { buildScope } from './scope.js';
```

Note: This barrel will error until subsequent tasks create the other files. That's expected — we'll build them next.

- [ ] **Step 3: Commit**

```bash
git add src/sdk/impersonate/types.ts src/sdk/impersonate/index.ts
git commit -m "feat(sdk): add ImpersonatedScope type and ImpersonationError"
```

---

## Task 2: Dialect Strategy Map

**Files:**
- Create: `tests/sdk/impersonate/dialect-strategy.test.ts`
- Create: `src/sdk/impersonate/dialect-strategy.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
/**
 * Dialect strategy tests.
 *
 * Verifies SQL generation and username validation for each
 * supported dialect's impersonation strategy.
 */
import { describe, it, expect } from 'bun:test';

import { dialectStrategy, validateUsername } from '../../../src/sdk/impersonate/dialect-strategy.js';

// ─────────────────────────────────────────────────────────────
// Username Validation
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate validateUsername', () => {

    it('should accept alphanumeric usernames', () => {

        expect(() => validateUsername('john_doe')).not.toThrow();

    });

    it('should accept usernames with @ . - \\', () => {

        expect(() => validateUsername('john@domain.com')).not.toThrow();
        expect(() => validateUsername('DOMAIN\\user')).not.toThrow();
        expect(() => validateUsername('first-last')).not.toThrow();

    });

    it('should reject usernames with single quotes', () => {

        expect(() => validateUsername("admin'; DROP TABLE users;--")).toThrow('ImpersonationError');

    });

    it('should reject usernames with semicolons', () => {

        expect(() => validateUsername('user;evil')).toThrow('ImpersonationError');

    });

    it('should reject empty usernames', () => {

        expect(() => validateUsername('')).toThrow('ImpersonationError');

    });

});

// ─────────────────────────────────────────────────────────────
// MSSQL Strategy
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate dialectStrategy mssql', () => {

    const strategy = dialectStrategy.mssql;

    it('should exist', () => {

        expect(strategy).not.toBeNull();

    });

    it('should generate EXECUTE AS USER SQL', () => {

        const sql = strategy!.impersonate('testuser');

        expect(sql).toBe("EXECUTE AS USER = 'testuser'");

    });

    it('should generate REVERT SQL', () => {

        expect(strategy!.revert()).toBe('REVERT');

    });

    it('should escape single quotes in username', () => {

        const sql = strategy!.impersonate("user'name");

        expect(sql).toBe("EXECUTE AS USER = 'user''name'");

    });

});

// ─────────────────────────────────────────────────────────────
// PostgreSQL Strategy
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate dialectStrategy postgres', () => {

    const strategy = dialectStrategy.postgres;

    it('should exist', () => {

        expect(strategy).not.toBeNull();

    });

    it('should generate SET ROLE SQL', () => {

        const sql = strategy!.impersonate('testuser');

        expect(sql).toBe("SET ROLE 'testuser'");

    });

    it('should generate RESET ROLE SQL', () => {

        expect(strategy!.revert()).toBe('RESET ROLE');

    });

    it('should escape single quotes in username', () => {

        const sql = strategy!.impersonate("user'name");

        expect(sql).toBe("SET ROLE 'user''name'");

    });

});

// ─────────────────────────────────────────────────────────────
// Unsupported Dialects
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate dialectStrategy unsupported', () => {

    it('should return null for mysql', () => {

        expect(dialectStrategy.mysql).toBeNull();

    });

    it('should return null for sqlite', () => {

        expect(dialectStrategy.sqlite).toBeNull();

    });

});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/impersonate/dialect-strategy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the dialect strategy implementation**

```typescript
/**
 * Dialect-specific impersonation strategies.
 *
 * Each supported dialect provides SQL for identity switching and
 * reverting. Unsupported dialects map to null — checked at call
 * time in Context.impersonate().
 */
import type { Dialect } from '../../core/connection/types.js';

import { ImpersonationError } from './types.js';

// ─────────────────────────────────────────────────────────────
// Strategy Interface
// ─────────────────────────────────────────────────────────────

export interface ImpersonationStrategy {
    impersonate: (username: string) => string;
    revert: () => string;
}

// ─────────────────────────────────────────────────────────────
// Username Validation
// ─────────────────────────────────────────────────────────────

const VALID_USERNAME = /^[a-zA-Z0-9_@.\-\\]+$/;

/**
 * Validate username against restrictive character set.
 *
 * Defense-in-depth before dialect-specific quoting. Rejects
 * characters that have no business in a database principal name.
 */
export function validateUsername(username: string): void {

    if (!username || !VALID_USERNAME.test(username)) {

        throw new ImpersonationError(
            `Invalid username for impersonation: "${username}". ` +
            'Only alphanumeric characters, underscores, @, dots, hyphens, and backslashes are allowed.',
        );

    }

}

// ─────────────────────────────────────────────────────────────
// Dialect Quoting
// ─────────────────────────────────────────────────────────────

/**
 * MSSQL single-quote escaping.
 *
 * Doubles any single quotes in the value. Used inside a
 * single-quoted string literal for EXECUTE AS USER.
 */
function mssqlQuote(value: string): string {

    return value.replace(/'/g, "''");

}

/**
 * PostgreSQL single-quote escaping.
 *
 * Doubles any single quotes in the value. Standard SQL escaping
 * for string literals in SET ROLE.
 */
function pgQuote(value: string): string {

    return value.replace(/'/g, "''");

}

// ─────────────────────────────────────────────────────────────
// Strategy Map
// ─────────────────────────────────────────────────────────────

/**
 * Dialect strategy map for impersonation.
 *
 * Supported dialects provide impersonate/revert SQL generators.
 * Unsupported dialects map to null — Context.impersonate() checks
 * this and throws ImpersonationError before borrowing a connection.
 */
export const dialectStrategy: Record<Dialect, ImpersonationStrategy | null> = {

    mssql: {
        impersonate: (username) => `EXECUTE AS USER = '${mssqlQuote(username)}'`,
        revert: () => 'REVERT',
    },

    postgres: {
        impersonate: (username) => `SET ROLE '${pgQuote(username)}'`,
        revert: () => 'RESET ROLE',
    },

    mysql: null,

    sqlite: null,

};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/impersonate/dialect-strategy.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/sdk/impersonate/dialect-strategy.ts tests/sdk/impersonate/dialect-strategy.test.ts
git commit -m "feat(sdk): add dialect impersonation strategies with username validation"
```

---

## Task 3: buildScope

**Files:**
- Create: `tests/sdk/impersonate/scope.test.ts`
- Create: `src/sdk/impersonate/scope.ts`

**Reference:** The test fixtures from `tests/sdk/context.test.ts:225-256` show how to create a mock Kysely instance with `DummyDriver` and intercepted `provideConnection`. Use the same pattern here.

- [ ] **Step 1: Write the failing tests**

```typescript
/**
 * Scope builder tests.
 *
 * Verifies that buildScope wires proc/func/transaction to the
 * dedicated connection and that revert is idempotent.
 */
import { describe, it, expect, vi } from 'bun:test';
import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import { buildScope } from '../../../src/sdk/impersonate/scope.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function createMockKysely(rows: Record<string, unknown>[] = []) {

    const executeQueryMock = vi.fn().mockResolvedValue({ rows });

    const db = new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    const originalExecutor = db.getExecutor();

    vi.spyOn(originalExecutor, 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: executeQueryMock,
            streamQuery: () => { throw new Error('not implemented'); },
        });

    });

    return { db, executeQueryMock };

}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate buildScope', () => {

    it('should expose the kysely instance', () => {

        const { db } = createMockKysely();
        const revertFn = vi.fn();
        const scope = buildScope(db, revertFn, 'postgres');

        expect(scope.kysely).toBe(db);

    });

    it('should route proc() through the scoped connection', async () => {

        const mockRows = [{ id: 1 }];
        const { db, executeQueryMock } = createMockKysely(mockRows);
        const scope = buildScope(db, vi.fn(), 'postgres');

        const result = await scope.proc('get_users', { department_id: 1 });

        expect(result).toEqual(mockRows);
        expect(executeQueryMock).toHaveBeenCalled();

    });

    it('should route func() through the scoped connection', async () => {

        const mockRows = [{ total: 99 }];
        const { db, executeQueryMock } = createMockKysely(mockRows);
        const scope = buildScope(db, vi.fn(), 'postgres');

        const result = await scope.func('calc_total', { order_id: 42 }, 'total');

        expect(result).toEqual({ total: 99 });
        expect(executeQueryMock).toHaveBeenCalled();

    });

    it('should call revertFn on revert()', async () => {

        const { db } = createMockKysely();
        const revertFn = vi.fn();
        const scope = buildScope(db, revertFn, 'postgres');

        await scope.revert();

        expect(revertFn).toHaveBeenCalledTimes(1);

    });

    it('should make revert() idempotent', async () => {

        const { db } = createMockKysely();
        const revertFn = vi.fn();
        const scope = buildScope(db, revertFn, 'postgres');

        await scope.revert();
        await scope.revert();
        await scope.revert();

        expect(revertFn).toHaveBeenCalledTimes(1);

    });

});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/impersonate/scope.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the scope builder implementation**

```typescript
/**
 * Impersonation scope builder.
 *
 * Constructs an ImpersonatedScope that wires proc/func/transaction
 * to a dedicated connection-bound Kysely instance. The revert
 * callback is provided by the caller (Context.impersonate).
 */
import { sql } from 'kysely';

import type { Kysely, Transaction } from 'kysely';
import type { Dialect } from '../../core/connection/types.js';

import { buildProcCall, buildFuncCall } from '../sql.js';
import type { ImpersonatedScope } from './types.js';

// ─────────────────────────────────────────────────────────────
// buildScope
// ─────────────────────────────────────────────────────────────

/**
 * Build a scoped query interface bound to a dedicated connection.
 *
 * The scope mirrors Context's query surface (kysely, proc, func,
 * transaction) but all operations route through the provided
 * connection-bound Kysely instance instead of the shared pool.
 *
 * @param db - Connection-bound Kysely instance from .connection().execute()
 * @param revertFn - Callback that executes dialect revert SQL and releases the connection
 * @param dialect - Current dialect for proc/func SQL generation
 *
 * @example
 * ```typescript
 * const scope = buildScope(db, async () => {
 *     await sql.raw('REVERT').execute(db);
 *     resolveHolder();
 * }, 'mssql');
 * ```
 */
export function buildScope<DB = unknown, Procs = object, Funcs = object>(
    db: Kysely<DB>,
    revertFn: () => Promise<void>,
    dialect: Dialect,
): ImpersonatedScope<DB, Procs, Funcs> {

    // === Declaration block ===
    let reverted = false;

    // === Business logic block ===
    return {

        kysely: db,

        async proc(name, ...args) {

            const params = args[0] as Record<string, unknown> | unknown[] | undefined;
            const query = buildProcCall(dialect, name as string, params);
            const result = await query.execute(db);

            return (result.rows ?? []) as any;

        },

        async func(name, ...args) {

            const hasParams = !(args.length === 1 && typeof args[0] === 'string');
            const params = hasParams ? args[0] as Record<string, unknown> | unknown[] : undefined;
            const column = (hasParams ? args[1] : args[0]) as string;

            const query = buildFuncCall(dialect, name as string, column, params);
            const result = await query.execute(db);

            return (result.rows?.[0] ?? null) as any;

        },

        async transaction<T>(fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {

            return db.transaction().execute(fn);

        },

        async revert() {

            if (reverted) return;
            reverted = true;

            await revertFn();

        },

    };

}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/impersonate/scope.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/sdk/impersonate/scope.ts tests/sdk/impersonate/scope.test.ts
git commit -m "feat(sdk): add impersonation scope builder"
```

---

## Task 4: Context.impersonate() — Callback Mode

**Files:**
- Create: `tests/sdk/impersonate/impersonate.test.ts`
- Modify: `src/sdk/context.ts`

**Reference:** `src/sdk/context.ts:8` for existing imports, `src/sdk/context.ts:182-186` for the transaction pattern this mirrors.

- [ ] **Step 1: Write the failing tests for callback mode**

Create `tests/sdk/impersonate/impersonate.test.ts`:

```typescript
/**
 * Context.impersonate() lifecycle tests.
 *
 * Verifies callback and explicit modes, dialect checking,
 * error propagation, and guaranteed revert behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
    sql,
} from 'kysely';

import { Context } from '../../../src/sdk/context.js';
import { ImpersonationError } from '../../../src/sdk/impersonate/types.js';

import type { Config } from '../../../src/core/config/types.js';
import type { Settings } from '../../../src/core/settings/types.js';
import type { Identity } from '../../../src/core/identity/types.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function createMockConfig(dialect: Config['connection']['dialect'] = 'postgres'): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        protected: false,
        connection: { dialect, database: 'testdb' },
    };

}

const mockSettings: Settings = {};

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

/**
 * Create a mock Kysely with connection() support.
 *
 * The key: we intercept provideConnection so .connection().execute()
 * calls our mock, and we track all raw SQL executed against it.
 */
function createMockKysely() {

    const executedSql: string[] = [];

    const executeQueryMock = vi.fn().mockImplementation((compiledQuery) => {

        executedSql.push(compiledQuery.sql);

        return { rows: [] };

    });

    const db = new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    const originalExecutor = db.getExecutor();

    vi.spyOn(originalExecutor, 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: executeQueryMock,
            streamQuery: () => { throw new Error('not implemented'); },
        });

    });

    return { db, executedSql, executeQueryMock };

}

function createCtx(dialect: Config['connection']['dialect'] = 'postgres') {

    const ctx = new Context(
        createMockConfig(dialect),
        mockSettings,
        mockIdentity,
        {},
        '/tmp/test-project',
    );

    const { db, executedSql, executeQueryMock } = createMockKysely();

    Object.defineProperty(ctx, 'kysely', { value: db, configurable: true });

    return { ctx, executedSql, executeQueryMock };

}

// ─────────────────────────────────────────────────────────────
// Unsupported Dialects
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate unsupported dialects', () => {

    it('should throw ImpersonationError for mysql', async () => {

        const { ctx } = createCtx('mysql');

        await expect(ctx.impersonate('user', async () => {})).rejects.toThrow(ImpersonationError);

    });

    it('should throw ImpersonationError for sqlite', async () => {

        const { ctx } = createCtx('sqlite');

        await expect(ctx.impersonate('user', async () => {})).rejects.toThrow(ImpersonationError);

    });

    it('should include dialect name in error message', async () => {

        const { ctx } = createCtx('mysql');

        await expect(ctx.impersonate('user', async () => {})).rejects.toThrow('mysql');

    });

});

// ─────────────────────────────────────────────────────────────
// Callback Mode
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate callback mode', () => {

    it('should execute impersonate SQL then revert SQL', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        await ctx.impersonate('testuser', async () => {});

        expect(executedSql[0]).toBe("SET ROLE 'testuser'");
        expect(executedSql[1]).toBe('RESET ROLE');

    });

    it('should return the callback result', async () => {

        const { ctx } = createCtx('postgres');

        const result = await ctx.impersonate('testuser', async () => 42);

        expect(result).toBe(42);

    });

    it('should provide a scope with kysely', async () => {

        const { ctx } = createCtx('postgres');

        await ctx.impersonate('testuser', async (scope) => {

            expect(scope.kysely).toBeDefined();
            expect(scope.proc).toBeFunction();
            expect(scope.func).toBeFunction();
            expect(scope.transaction).toBeFunction();
            expect(scope.revert).toBeFunction();

        });

    });

    it('should revert even when callback throws', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        await expect(
            ctx.impersonate('testuser', async () => { throw new Error('boom'); }),
        ).rejects.toThrow('boom');

        expect(executedSql[0]).toBe("SET ROLE 'testuser'");
        expect(executedSql[1]).toBe('RESET ROLE');

    });

    it('should generate EXECUTE AS for mssql', async () => {

        const { ctx, executedSql } = createCtx('mssql');

        await ctx.impersonate('testuser', async () => {});

        expect(executedSql[0]).toBe("EXECUTE AS USER = 'testuser'");
        expect(executedSql[1]).toBe('REVERT');

    });

});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/impersonate/impersonate.test.ts`
Expected: FAIL — `ctx.impersonate is not a function`

- [ ] **Step 3: Add the impersonate() method to Context (callback mode only)**

Modify `src/sdk/context.ts`:

Add imports at the top (after existing imports around line 16-19):

```typescript
import { sql } from 'kysely';
import { dialectStrategy, validateUsername } from './impersonate/dialect-strategy.js';
import { buildScope } from './impersonate/scope.js';
import { ImpersonationError } from './impersonate/types.js';
import type { ImpersonatedScope } from './impersonate/types.js';
```

Add the `impersonate()` method to the Context class, after the `func()` method (after line 269):

```typescript
    // ─────────────────────────────────────────────────────────
    // Impersonation
    // ─────────────────────────────────────────────────────────

    /**
     * Execute queries as a specific database principal.
     *
     * Borrows a dedicated connection from the pool, switches identity
     * via dialect-specific SQL, and provides a scoped query interface.
     * Two modes: callback (auto-reverts) and explicit (caller reverts).
     *
     * @example
     * ```typescript
     * // Callback mode — auto-reverts, even on throw
     * const result = await ctx.impersonate('username', async (scope) => {
     *     return scope.kysely.selectFrom('users').selectAll().execute();
     * });
     *
     * // Explicit mode — caller owns lifecycle
     * const scope = await ctx.impersonate('username');
     * const users = await scope.kysely.selectFrom('users').selectAll().execute();
     * await scope.revert();
     * ```
     */
    async impersonate<T>(
        username: string,
        fn: (scope: ImpersonatedScope<DB, Procs, Funcs>) => Promise<T>,
    ): Promise<T>;
    async impersonate(
        username: string,
    ): Promise<ImpersonatedScope<DB, Procs, Funcs>>;
    async impersonate<T>(
        username: string,
        fn?: (scope: ImpersonatedScope<DB, Procs, Funcs>) => Promise<T>,
    ): Promise<T | ImpersonatedScope<DB, Procs, Funcs>> {

        // === Validation block ===
        const strategy = dialectStrategy[this.dialect];

        if (!strategy) {

            throw new ImpersonationError(
                `Impersonation is not supported for the ${this.dialect} dialect.`,
            );

        }

        validateUsername(username);

        // === Business logic block ===
        const impersonateSql = strategy.impersonate(username);
        const revertSql = strategy.revert();

        if (fn) {

            return this.#impersonateCallback(impersonateSql, revertSql, fn);

        }

        return this.#impersonateExplicit(impersonateSql, revertSql);

    }

    async #impersonateCallback<T>(
        impersonateSql: string,
        revertSql: string,
        fn: (scope: ImpersonatedScope<DB, Procs, Funcs>) => Promise<T>,
    ): Promise<T> {

        return this.kysely.connection().execute(async (db) => {

            await sql.raw(impersonateSql).execute(db);

            const scope = buildScope<DB, Procs, Funcs>(db, async () => {

                await sql.raw(revertSql).execute(db);

            }, this.dialect);

            try {

                return await fn(scope);

            }
            finally {

                await sql.raw(revertSql).execute(db);

            }

        });

    }

    async #impersonateExplicit(
        _impersonateSql: string,
        _revertSql: string,
    ): Promise<ImpersonatedScope<DB, Procs, Funcs>> {

        // Placeholder — implemented in next task
        throw new Error('Explicit mode not yet implemented');

    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/impersonate/impersonate.test.ts`
Expected: All callback mode + unsupported dialect tests PASS

- [ ] **Step 5: Run existing SDK tests to verify no regressions**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/sdk/context.ts tests/sdk/impersonate/impersonate.test.ts
git commit -m "feat(sdk): add impersonate() callback mode to Context"
```

---

## Task 5: Context.impersonate() — Explicit Mode

**Files:**
- Modify: `tests/sdk/impersonate/impersonate.test.ts`
- Modify: `src/sdk/context.ts`

- [ ] **Step 1: Add explicit mode tests**

Append to `tests/sdk/impersonate/impersonate.test.ts`:

```typescript
// ─────────────────────────────────────────────────────────────
// Explicit Mode
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate explicit mode', () => {

    it('should return a scope', async () => {

        const { ctx } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        expect(scope.kysely).toBeDefined();
        expect(scope.revert).toBeFunction();

        await scope.revert();

    });

    it('should execute impersonate SQL on acquire', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        expect(executedSql[0]).toBe("SET ROLE 'testuser'");

        await scope.revert();

    });

    it('should execute revert SQL on scope.revert()', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        await scope.revert();

        expect(executedSql[1]).toBe('RESET ROLE');

    });

    it('should make revert() idempotent', async () => {

        const { ctx, executedSql } = createCtx('postgres');

        const scope = await ctx.impersonate('testuser');

        await scope.revert();
        await scope.revert();
        await scope.revert();

        // Only one RESET ROLE, not three
        const revertCount = executedSql.filter(s => s === 'RESET ROLE').length;

        expect(revertCount).toBe(1);

    });

    it('should work with mssql dialect', async () => {

        const { ctx, executedSql } = createCtx('mssql');

        const scope = await ctx.impersonate('testuser');

        expect(executedSql[0]).toBe("EXECUTE AS USER = 'testuser'");

        await scope.revert();

        expect(executedSql[1]).toBe('REVERT');

    });

    it('should throw for unsupported dialect in explicit mode', async () => {

        const { ctx } = createCtx('mysql');

        await expect(ctx.impersonate('user')).rejects.toThrow(ImpersonationError);

    });

});
```

- [ ] **Step 2: Run tests to verify explicit mode tests fail**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/impersonate/impersonate.test.ts`
Expected: Explicit mode tests FAIL (placeholder throws), callback mode tests still PASS

- [ ] **Step 3: Implement the explicit mode**

Replace the `#impersonateExplicit` placeholder in `src/sdk/context.ts`:

```typescript
    async #impersonateExplicit(
        impersonateSql: string,
        revertSql: string,
    ): Promise<ImpersonatedScope<DB, Procs, Funcs>> {

        // === Declaration block ===
        let resolveHolder!: () => void;
        const connectionHeld = new Promise<void>(resolve => {

            resolveHolder = resolve;

        });

        let resolveReady!: (scope: ImpersonatedScope<DB, Procs, Funcs>) => void;
        let rejectReady!: (err: unknown) => void;
        const ready = new Promise<ImpersonatedScope<DB, Procs, Funcs>>((resolve, reject) => {

            resolveReady = resolve;
            rejectReady = reject;

        });

        // === Business logic block ===
        const connectionDone = this.kysely.connection().execute(async (db) => {

            await sql.raw(impersonateSql).execute(db);

            const scope = buildScope<DB, Procs, Funcs>(db, async () => {

                await sql.raw(revertSql).execute(db);
                resolveHolder();

            }, this.dialect);

            resolveReady(scope);

            await connectionHeld;

        });

        connectionDone.catch(err => rejectReady(err));

        // === Commit block ===
        return ready;

    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/impersonate/impersonate.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full SDK test suite**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/sdk/context.ts tests/sdk/impersonate/impersonate.test.ts
git commit -m "feat(sdk): add impersonate() explicit mode with deferred promise pattern"
```

---

## Task 6: SDK Exports and Barrel Cleanup

**Files:**
- Modify: `src/sdk/impersonate/index.ts`
- Modify: `src/sdk/index.ts`

- [ ] **Step 1: Verify the barrel export is correct**

Read `src/sdk/impersonate/index.ts` — it was created in Task 1 with forward references. Now that all files exist, verify it imports correctly.

Run: `cd /Users/alonso/projects/noorm/monorepo && bun run typecheck`
Expected: No errors from the impersonate module. Fix any issues.

- [ ] **Step 2: Add re-exports to the SDK entry point**

Modify `src/sdk/index.ts` — add after the existing guard exports (around line 169):

```typescript
// Impersonation
export { ImpersonationError } from './impersonate/index.js';
export type { ImpersonatedScope } from './impersonate/index.js';
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun run typecheck`
Expected: Clean

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/sdk/`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/sdk/impersonate/index.ts src/sdk/index.ts
git commit -m "feat(sdk): export ImpersonatedScope and ImpersonationError from SDK"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run full project build**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun run build`
Expected: Clean build

- [ ] **Step 2: Run full project typecheck**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun run typecheck`
Expected: Clean

- [ ] **Step 3: Run full project tests**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun run test`
Expected: All pass (except pre-existing failures noted in MEMORY.md: better-sqlite3 module version mismatch tests)

- [ ] **Step 4: Run lint**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun run lint`
Expected: Clean
