# SDK Finish Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the noorm SDK for public release by removing the `allowProtected` escape hatch, expanding the protected-config guard to all destructive operations, and adding lifecycle + guard + destructive-ops test coverage against a real PostgreSQL instance.

**Architecture:** Three workstreams executed in order — (1) remove `allowProtected` and simplify the guard signature, (2) wire the guard to additional destructive ops (`dt.importFile`, `changes.revert`), (3) write tests that prove all of the above. Tests use the project's existing Docker PG container (same infra as transfer/integration tests). No mocks for lifecycle tests.

**Tech Stack:** TypeScript, Bun test runner, `@noormdev/sdk` source at `src/sdk/`, test files at `tests/sdk/`, PostgreSQL via Docker for lifecycle/destructive-ops tests.

---

## Context for the implementer

Before starting, understand these three files:

- `src/sdk/guards.ts` — two guard functions and their error classes. `checkProtectedConfig` currently takes `(config, operation, options)` and reads `options.allowProtected`.
- `src/sdk/types.ts` — `CreateContextOptions` interface. `allowProtected` lives here.
- `src/sdk/namespaces/db.ts` — calls `checkProtectedConfig(this.#state.config, 'truncate/teardown/reset', this.#state.options)` for destructive ops.

`checkRequireTest` is already correctly called before the connection pool opens (pool opens in `ctx.connect()`, not in `createContext()`). We need a test that proves this, not a code change.

---

## Task 1: Remove `allowProtected` — types and guards

**Files:**
- Modify: `src/sdk/types.ts`
- Modify: `src/sdk/guards.ts`

- [ ] **Step 1: Remove `allowProtected` from `CreateContextOptions`**

In `src/sdk/types.ts`, delete the `allowProtected` field and its JSDoc comment and example:

```typescript
// REMOVE this field entirely from CreateContextOptions:
//   /** Allow destructive ops on protected configs. Default: false */
//   allowProtected?: boolean;

// Also remove the allowProtected example from the @example block:
//   // Allow destructive ops on protected config
//   const ctx = await createContext({
//       config: 'staging',
//       allowProtected: true,
//   })
```

After edit, `CreateContextOptions` should have only: `config`, `projectRoot`, `requireTest`, `stage`.

- [ ] **Step 2: Simplify `checkProtectedConfig` signature**

In `src/sdk/guards.ts`, change the function signature — drop the `options` parameter entirely:

```typescript
/**
 * Check if operation is allowed on protected config.
 *
 * Protected configs unconditionally block all destructive operations.
 * There is no override. To run a destructive op against a protected
 * config, the user must manually set config.protected = false first.
 *
 * @throws ProtectedConfigError if config is protected
 */
export function checkProtectedConfig(
    config: Config,
    operation: string,
): void {

    if (config.protected) {

        throw new ProtectedConfigError(config.name, operation);

    }

}
```

- [ ] **Step 3: Remove the `allowProtected` JSDoc example from `ProtectedConfigError`**

In `src/sdk/guards.ts`, update the `ProtectedConfigError` JSDoc to remove the reference to `allowProtected`:

```typescript
/**
 * Error thrown when attempting destructive operations on protected configs.
 *
 * @example
 * ```typescript
 * // config.protected is true — all destructive ops are blocked
 * await ctx.noorm.db.truncate()  // Throws ProtectedConfigError
 * ```
 */
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
bun run typecheck
```

Expected: type errors at the three `db.ts` call sites (too many arguments). This is expected — fix in next task.

---

## Task 2: Update `db.ts` call sites

**Files:**
- Modify: `src/sdk/namespaces/db.ts`

- [ ] **Step 1: Update the three `checkProtectedConfig` calls**

In `src/sdk/namespaces/db.ts`, remove `this.#state.options` from all three calls:

```typescript
// truncate (line ~277)
checkProtectedConfig(this.#state.config, 'truncate');

// teardown (line ~299)
checkProtectedConfig(this.#state.config, 'teardown');

// reset (line ~320)
checkProtectedConfig(this.#state.config, 'reset');
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/sdk/guards.ts src/sdk/types.ts src/sdk/namespaces/db.ts
git commit -m "feat(sdk): remove allowProtected — protected configs unconditionally block destructive ops"
```

---

## Task 3: Extend protected guard to `dt.importFile`

**Files:**
- Modify: `src/sdk/namespaces/dt.ts`

The `dt.importFile` operation bulk-writes data into the database. On a protected config this is a destructive operation.

- [ ] **Step 1: Read the current `importFile` method**

In `src/sdk/namespaces/dt.ts`, find `importFile` (the method that calls `importDtFile`).

- [ ] **Step 2: Add `checkProtectedConfig` import and guard**

At the top of `src/sdk/namespaces/dt.ts`, add the import:

```typescript
import { checkProtectedConfig } from '../guards.js';
```

Inside the `importFile` method, add the guard as the first line of the method body:

```typescript
async importFile(
    filepath: string,
    options?: ImportOptions,
): Promise<[{ rowsImported: number } | null, Error | null]> {

    checkProtectedConfig(this.#state.config, 'dt.import');

    return importDtFile({ ... });  // existing call unchanged

}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/sdk/namespaces/dt.ts
git commit -m "feat(sdk): block dt.importFile on protected configs"
```

---

## Task 4: Extend protected guard to `changes.revert`

**Files:**
- Modify: `src/sdk/namespaces/changes.ts`

Rolling back a change in production is destructive (it drops schema or data). Forward migrations are fine on protected configs; only revert/rollback ops are blocked.

- [ ] **Step 1: Read `changes.ts` revert methods**

```bash
grep -n "revert\|revertOne\|ff\|apply\b" src/sdk/namespaces/changes.ts
```

Note: `revert(name)` and any batch revert ops need the guard. `apply`, `ff`, `applyOne` do NOT get the guard (forward migrations are safe).

- [ ] **Step 2: Add import and guard to `revert`**

At the top of `src/sdk/namespaces/changes.ts`, add:

```typescript
import { checkProtectedConfig } from '../guards.js';
```

In the `revert` method, add the guard as the first line:

```typescript
async revert(name: string, options?: ChangeOptions): Promise<ChangeResult> {

    checkProtectedConfig(this.#state.config, 'changes.revert');

    return this.#getManager().revert(name, options);

}
```

If there is a `revertOne` or batch revert method, apply the same pattern to each.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/sdk/namespaces/changes.ts
git commit -m "feat(sdk): block changes.revert on protected configs"
```

---

## Task 5: Write `tests/sdk/guards.test.ts`

**Files:**
- Create: `tests/sdk/guards.test.ts`

These tests are unit-level — no real DB needed. Use a mock config object.

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect } from 'bun:test';
import { checkRequireTest, checkProtectedConfig, RequireTestError, ProtectedConfigError } from '../../src/sdk/guards.js';
import type { Config } from '../../src/core/config/types.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
    return {
        name: 'test',
        type: 'local',
        isTest: true,
        protected: false,
        connection: { dialect: 'postgres', database: 'testdb' },
        ...overrides,
    } as Config;
}

describe('checkRequireTest', () => {
    it('does not throw when requireTest is false', () => {
        expect(() => checkRequireTest(makeConfig({ isTest: false }), { requireTest: false })).not.toThrow();
    });

    it('does not throw when requireTest is true and config.isTest is true', () => {
        expect(() => checkRequireTest(makeConfig({ isTest: true }), { requireTest: true })).not.toThrow();
    });

    it('throws RequireTestError when requireTest is true but config.isTest is false', () => {
        const config = makeConfig({ name: 'prod', isTest: false });
        expect(() => checkRequireTest(config, { requireTest: true })).toThrow(RequireTestError);
    });

    it('RequireTestError carries the config name', () => {
        const config = makeConfig({ name: 'prod', isTest: false });
        let caught: unknown;
        try { checkRequireTest(config, { requireTest: true }); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(RequireTestError);
        expect((caught as RequireTestError).configName).toBe('prod');
    });

    it('does not throw when requireTest is omitted', () => {
        expect(() => checkRequireTest(makeConfig({ isTest: false }), {})).not.toThrow();
    });
});

describe('checkProtectedConfig', () => {
    it('does not throw on non-protected config', () => {
        expect(() => checkProtectedConfig(makeConfig({ protected: false }), 'truncate')).not.toThrow();
    });

    it('throws ProtectedConfigError on protected config', () => {
        const config = makeConfig({ name: 'prod', protected: true });
        expect(() => checkProtectedConfig(config, 'truncate')).toThrow(ProtectedConfigError);
    });

    it('ProtectedConfigError carries config name and operation', () => {
        const config = makeConfig({ name: 'prod', protected: true });
        let caught: unknown;
        try { checkProtectedConfig(config, 'teardown'); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(ProtectedConfigError);
        expect((caught as ProtectedConfigError).configName).toBe('prod');
        expect((caught as ProtectedConfigError).operation).toBe('teardown');
    });

    it('blocks all named destructive operations', () => {
        const config = makeConfig({ name: 'prod', protected: true });
        const ops = ['truncate', 'teardown', 'reset', 'dt.import', 'changes.revert'];
        for (const op of ops) {
            expect(() => checkProtectedConfig(config, op)).toThrow(ProtectedConfigError);
        }
    });
});
```

- [ ] **Step 2: Run the tests**

```bash
bun test tests/sdk/guards.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/sdk/guards.test.ts
git commit -m "test(sdk): add guard unit tests for requireTest and protected config"
```

---

## Task 6: Write `tests/sdk/lifecycle.test.ts`

**Files:**
- Create: `tests/sdk/lifecycle.test.ts`

These tests verify `createContext` + `connect`/`disconnect` behavior. Most cases do NOT require a real DB — they test that the factory rejects early before any connection is attempted.

For the "pool never opens on requireTest failure" test we need to verify that `ctx.connect()` was never called, which we can prove by checking that `checkRequireTest` throws inside `createContext` itself (before `ctx.connect()` is ever called).

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect } from 'bun:test';
import { createContext, RequireTestError } from '../../src/sdk/index.js';
import type { CreateContextOptions } from '../../src/sdk/index.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Build a minimal CreateContextOptions that points at a fake project root
 * with a test config. We use env-var override mode so no real state file
 * is needed.
 *
 * NOTE: These tests must NOT call ctx.connect() — they test factory behavior,
 * not DB connectivity.
 */
function envOnlyOptions(overrides: Partial<CreateContextOptions> = {}): CreateContextOptions {
    return {
        projectRoot: new URL('../../', import.meta.url).pathname,
        ...overrides,
    };
}

describe('createContext', () => {
    it('throws when named config is not found', async () => {
        await expect(
            createContext({ ...envOnlyOptions(), config: '__nonexistent_config__' })
        ).rejects.toThrow('not found');
    });

    it('throws RequireTestError when requireTest=true and config.isTest=false', async () => {
        // We need a config where isTest=false. Use env-only mode to inject one.
        process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
        process.env['NOORM_CONNECTION_DATABASE'] = 'testdb';
        process.env['NOORM_IS_TEST'] = 'false';

        try {
            await expect(
                createContext({ ...envOnlyOptions(), requireTest: true })
            ).rejects.toThrow(RequireTestError);
        } finally {
            delete process.env['NOORM_CONNECTION_DIALECT'];
            delete process.env['NOORM_CONNECTION_DATABASE'];
            delete process.env['NOORM_IS_TEST'];
        }
    });

    it('returns a Context that is not yet connected', async () => {
        process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
        process.env['NOORM_CONNECTION_DATABASE'] = 'testdb';
        process.env['NOORM_IS_TEST'] = 'true';

        try {
            const ctx = await createContext(envOnlyOptions());
            expect(ctx.connected).toBe(false);
        } finally {
            delete process.env['NOORM_CONNECTION_DIALECT'];
            delete process.env['NOORM_CONNECTION_DATABASE'];
            delete process.env['NOORM_IS_TEST'];
        }
    });
});

describe('Context lifecycle', () => {
    it('ctx.kysely throws if called before connect()', async () => {
        process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
        process.env['NOORM_CONNECTION_DATABASE'] = 'testdb';
        process.env['NOORM_IS_TEST'] = 'true';

        try {
            const ctx = await createContext(envOnlyOptions());
            expect(() => ctx.kysely).toThrow('Not connected');
        } finally {
            delete process.env['NOORM_CONNECTION_DIALECT'];
            delete process.env['NOORM_CONNECTION_DATABASE'];
            delete process.env['NOORM_IS_TEST'];
        }
    });
});
```

**Note:** Before writing these tests, check how env-only mode works by reading `src/core/config/resolver.ts` to confirm which env vars control `isTest`. If `NOORM_IS_TEST` is not a real env var, adjust the test to use whatever mechanism resolves `isTest` from env. If there is no env override for `isTest`, skip that specific test and leave a `// TODO` comment explaining why, rather than writing a test that can't pass.

- [ ] **Step 2: Investigate env-only config resolution**

```bash
grep -n "NOORM_IS_TEST\|isTest\|IS_TEST" src/core/config/resolver.ts src/core/config/env.ts 2>/dev/null | head -30
```

Adjust the test file accordingly based on actual env var names.

- [ ] **Step 3: Run tests**

```bash
bun test tests/sdk/lifecycle.test.ts
```

Expected: all pass (or skip the isTest env test if that mechanism doesn't exist, and leave a clear comment).

- [ ] **Step 4: Commit**

```bash
git add tests/sdk/lifecycle.test.ts
git commit -m "test(sdk): add lifecycle tests for createContext and connection guards"
```

---

## Task 7: Write `tests/sdk/destructive-ops.test.ts`

**Files:**
- Create: `tests/sdk/destructive-ops.test.ts`

These tests verify that the protected guard blocks all destructive operations. They do NOT require a real DB — the guard throws before any DB call is made. Use a mock Context built from a protected config.

- [ ] **Step 1: Read how existing db-namespace tests create a context**

```bash
cat tests/sdk/db-namespace.test.ts | head -80
```

Use the same mock/fixture pattern.

- [ ] **Step 2: Create the test file**

```typescript
import { describe, it, expect } from 'bun:test';
import { ProtectedConfigError } from '../../src/sdk/guards.js';

// Import namespaces directly to test guards without needing a real DB.
// We construct minimal ContextState objects to drive the guard.
import { DbNamespace } from '../../src/sdk/namespaces/db.js';
import { DtNamespace } from '../../src/sdk/namespaces/dt.js';
import { ChangesNamespace } from '../../src/sdk/namespaces/changes.js';
import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';

function makeProtectedState(): ContextState {
    return {
        connection: null,
        config: {
            name: 'prod',
            type: 'local',
            isTest: false,
            protected: true,
            connection: { dialect: 'postgres', database: 'testdb' },
        } as Config,
        settings: {} as never,
        identity: {} as never,
        options: {},
        projectRoot: '/tmp',
        changeManager: null,
    };
}

function makeUnprotectedState(): ContextState {
    return {
        ...makeProtectedState(),
        config: {
            ...makeProtectedState().config,
            name: 'dev',
            protected: false,
        },
    };
}

describe('protected config guard — db namespace', () => {
    it('truncate throws ProtectedConfigError on protected config', async () => {
        const ns = new DbNamespace(makeProtectedState());
        await expect(ns.truncate()).rejects.toThrow(ProtectedConfigError);
    });

    it('teardown throws ProtectedConfigError on protected config', async () => {
        const ns = new DbNamespace(makeProtectedState());
        await expect(ns.teardown()).rejects.toThrow(ProtectedConfigError);
    });

    it('reset throws ProtectedConfigError on protected config', async () => {
        const ns = new DbNamespace(makeProtectedState());
        await expect(ns.reset()).rejects.toThrow(ProtectedConfigError);
    });

    it('truncate does NOT throw on unprotected config (proceeds to DB call)', async () => {
        const ns = new DbNamespace(makeUnprotectedState());
        // Will throw "Not connected" — that's past the guard, which is what we're testing
        await expect(ns.truncate()).rejects.not.toThrow(ProtectedConfigError);
    });
});

describe('protected config guard — dt namespace', () => {
    it('importFile throws ProtectedConfigError on protected config', async () => {
        const ns = new DtNamespace(makeProtectedState());
        await expect(ns.importFile('./fake.dtz')).rejects.toThrow(ProtectedConfigError);
    });

    it('exportTable does NOT throw ProtectedConfigError (read-only op)', async () => {
        const ns = new DtNamespace(makeUnprotectedState());
        // Will fail past the guard — that's what we're testing
        await expect(ns.exportTable('users', './fake.dtz')).rejects.not.toThrow(ProtectedConfigError);
    });
});

describe('protected config guard — changes namespace', () => {
    it('revert throws ProtectedConfigError on protected config', async () => {
        const ns = new ChangesNamespace(makeProtectedState());
        await expect(ns.revert('2024-01-15-add-users')).rejects.toThrow(ProtectedConfigError);
    });

    it('apply does NOT throw ProtectedConfigError (forward migration)', async () => {
        const ns = new ChangesNamespace(makeUnprotectedState());
        // Will fail past the guard — that's what we're testing
        await expect(ns.apply('2024-01-15-add-users')).rejects.not.toThrow(ProtectedConfigError);
    });
});
```

**Note:** The exact shape of `ContextState` may differ from what's shown above — check `src/sdk/state.ts` for the real interface and adjust field names accordingly. The DtNamespace and ChangesNamespace constructor signatures may also differ — read the actual constructors before writing.

- [ ] **Step 3: Run tests**

```bash
bun test tests/sdk/destructive-ops.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/sdk/destructive-ops.test.ts
git commit -m "test(sdk): add destructive-ops tests proving protected guard blocks all destructive operations"
```

---

## Task 8: Run full test suite and verify no regressions

- [ ] **Step 1: Run all SDK tests**

```bash
bun test tests/sdk/
```

Expected: all pass. If any test uses `allowProtected` and now fails, update that test to remove the option.

- [ ] **Step 2: Grep for any remaining `allowProtected` references**

```bash
grep -rn "allowProtected" src/ tests/
```

Expected: zero matches.

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit if any fixups were needed**

```bash
git add -p
git commit -m "fix(sdk): remove remaining allowProtected references from tests"
```

---

## Task 9: Update `TODO.md`

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Mark the three SDK Finish Line items as done**

In `TODO.md`, under `### SDK Finish Line`, change:

```markdown
- [ ] **SDK test coverage** - Dedicated tests for SDK surface (`createContext`, lifecycle, operations)
- [ ] **Test mode enforcement** - When `requireTest: true`, SDK must refuse to connect if `config.isTest !== true`
- [ ] **Protected config hard block** - Destructive operations (destroy, truncate, teardown) on protected configs are denied with no override. Remove `allowProtected` option entirely.
```

to:

```markdown
- [x] **SDK test coverage** - Dedicated tests for SDK surface (`createContext`, lifecycle, operations)
- [x] **Test mode enforcement** - When `requireTest: true`, SDK must refuse to connect if `config.isTest !== true`
- [x] **Protected config hard block** - Destructive operations (destroy, truncate, teardown) on protected configs are denied with no override. Remove `allowProtected` option entirely.
```

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "chore: mark SDK finish line items as complete in TODO"
```
