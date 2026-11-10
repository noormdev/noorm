---
paths:
  - "tests/**/*.{ts,tsx}"
---

# Testing rules


Runner is `bun:test`. `bun run test` is `bun test --serial`, and `bunfig.toml` pins `concurrency = 1`, `timeout = 30000`, and `preload = ["./tests/preload.ts"]`. All 315 test files import from `'bun:test'`; nothing here uses vitest or jest.


## Before running anything

Integration tests need live databases on non-default ports (postgres `15432`, mysql `13306`, mssql `11433`):

```bash
docker compose -f docker-compose.test.yml up -d
```

`skipIfNoContainer(dialect)` (`tests/utils/db.ts:892`) **throws, it does not skip**, despite the name. 40 files call it in `beforeAll`. Without the containers up you get a wall of failures that read like real regressions. Check the containers before you believe a red suite.


## Database safety

The suite runs `TRUNCATE`, `DROP`, and teardown. `assertTestDatabase` (`tests/utils/db.ts:122`) refuses to connect unless the resolved database name is `:memory:` or contains `test` as a `_`/`-` delimited word, and `createTestConnection` calls it on every connection. It exists so a stray `.env` or leaked CI secret cannot aim a destructive suite at a real database.

Never bypass it by building a Kysely instance by hand. Route test connections through `createTestConnection`.


## Naming

`describe('module: feature', ...)` — 414 of 420 top-level describes follow this. Group by module, then by feature. Prefix `it` descriptions with "should".

```ts
describe('runner: executeFile', () => {

    it('should skip unchanged files', async () => {

        // ...

    });

});
```


## Errors

Use `attempt`/`attemptSync` and assert on the tuple. Assert the error *and* the side effects that should or should not have happened.

```ts
const [result, err] = await attempt(() => executeFile(badPath));

expect(err).toBeInstanceOf(InvalidFileError);
expect(result).toBeUndefined();
```

The no-`try/catch` rule in `typescript.md` covers `tests/**` too, and 17 blocks currently violate it. Do not add more.


## Observer events

Modules that emit events should have their emissions asserted, not just their return values. This applies to the ~20 files testing event-emitting modules (`core/change/executor`, `core/transfer/*`, `core/lifecycle/*`, and similar), not to the suite at large.

```ts
const events: ChangeEvent[] = [];
observer.on('file:after', (data) => events.push(data));

const [, err] = await attempt(() => executeFile(badFile, configName));

expect(err).toBeInstanceOf(Error);
expect(events[0].status).toBe('failed');
```


## Module mocking

Bun's `mock.module` registry is process-global and never restores, so a mocking file poisons every file loaded after it. CI works around this by splitting the suite into five separate processes. The mechanics and the reasoning are in the root `CLAUDE.md`; read it before adding `mock.module` to a new file.


## Helpers

`tests/utils/db.ts` is the shared database harness:

| Export | Purpose |
|--------|---------|
| `createTestConnection` | guarded connection; use instead of building Kysely directly |
| `assertTestDatabase`, `NotATestDatabaseError` | the naming-convention safety guard |
| `TEST_CONNECTIONS`, `makeTestConfig` | per-dialect connection details and a filled-in `Config` |
| `deployTestSchema`, `seedTestData`, `resetTestData`, `teardownTestSchema` | fixture lifecycle |
| `isContainerRunning`, `skipIfNoContainer` | container preflight |

SQL fixtures live in `tests/fixtures/sql/<dialect>/`. `tests/integration/cli/setup.ts` spawns the built CLI for headless tests.

`tests/global-setup.ts` and `tests/global-teardown.ts` are **dead code**, left over from vitest. Nothing wires them: `bunfig.toml` sets only `preload`, and there is no vitest config in the repo. Editing them changes nothing. Real preload work belongs in `tests/preload.ts`, which pins `NOORM_CHANNEL` and strips agent-harness markers so policy-gated tests behave the same locally and in CI.
