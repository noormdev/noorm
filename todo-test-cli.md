# CLI Headless Integration Test Plan


## Overview

Integration tests for headless CLI mode using zx/lite. Tests execute the actual CLI binary and assert on stdout, stderr, exit codes, and JSON output.


## Setup


### Dependencies

```bash
npm i -D zx@lite
```


### zx/lite API Reference

```typescript
import { $ } from 'zx'

// Basic execution
await $`noorm -H db explore`

// Capture output (ProcessPromise returns ProcessOutput)
const result = await $`noorm -H --json db explore`
result.stdout    // string: command output
result.stderr    // string: error output
result.exitCode  // number: 0 = success, 1 = failure
result.ok        // boolean: exitCode === 0

// Suppress errors for testing failure cases
const result = await $({nothrow: true})`noorm -H bad-command`

// Configuration presets
const $$ = $({
    verbose: false,     // quiet zx output
    timeout: 30000,     // timeout in ms
    env: { NOORM_HEADLESS: 'true' }
})

// Sync execution (rarely needed)
const result = $.sync`pwd`
```


### Test Directory Structure

```
tests/integration/cli/
├── setup.ts           # Shared setup, CLI helper, fixtures
├── db.test.ts         # db/explore, db/truncate, db/teardown
├── changeset.test.ts  # change/*, history
├── run.test.ts        # run/build, run/file, run/dir
├── lock.test.ts       # lock/status, lock/acquire, lock/release
├── config.test.ts     # config/use
└── help.test.ts       # help command
```


### CLI Helper (setup.ts)

```typescript
import { $ } from 'zx'
import { join } from 'node:path'

const CLI = join(import.meta.dirname, '../../../dist/cli/index.js')

// Configure $ for tests
export const cli = $({
    verbose: false,
    nothrow: true,  // Don't throw on non-zero exit
})

// Helper to run CLI commands
export async function noorm(...args: string[]) {
    const cmd = ['node', CLI, '-H', ...args].join(' ')
    return cli`${cmd}`
}

// JSON mode helper
export async function noormJson<T>(...args: string[]): Promise<T> {
    const result = await noorm('--json', ...args)
    return JSON.parse(result.stdout) as T
}

// Light color testing utilities
export function hasAnsiColors(output: string): boolean {
    return /\x1b\[[0-9;]*m/.test(output)
}

export function stripAnsi(output: string): string {
    return output.replace(/\x1b\[[0-9;]*m/g, '')
}
```


## Test Categories


### 1. Database Operations (db.test.ts)

| Command | Test Cases |
|---------|------------|
| `db/explore` | Returns counts (tables, views, functions); JSON format valid |
| `db/explore/tables` | Lists all tables; shows column counts |
| `db/explore/tables/detail --name users` | Shows columns, types, constraints; error on missing table |
| `db/truncate` | Clears data; requires --yes or prompts; data actually cleared |
| `db/teardown` | Drops all objects; requires --yes; schema actually gone |


### 2. Changeset Operations (changeset.test.ts)

| Command | Test Cases |
|---------|------------|
| `change` | Lists pending/applied changesets |
| `change/ff` | Applies all pending; returns count; handles empty |
| `change/run --name X` | Applies specific changeset; error on missing |
| `change/revert --name X` | Reverts changeset; error on missing |
| `change/history` | Shows execution history; respects --count |


### 3. Run Operations (run.test.ts)

| Command | Test Cases |
|---------|------------|
| `run/build` | Executes schema files; reports success/skip/fail counts |
| `run/file --path X` | Executes single file; checksum handling |
| `run/dir --path X` | Executes directory; recursive handling |


### 4. Lock Operations (lock.test.ts)

| Command | Test Cases |
|---------|------------|
| `lock/status` | Shows lock state (locked/unlocked) |
| `lock/acquire` | Acquires lock; fails if already locked |
| `lock/release` | Releases lock; error if not locked |


### 5. Config Operations (config.test.ts)

| Command | Test Cases |
|---------|------------|
| `config/use --name X` | Sets active config; error on missing |


### 6. Help (help.test.ts)

| Command | Test Cases |
|---------|------------|
| `help` | Shows general help |
| `help db explore` | Shows topic-specific help |


## Test Patterns


### JSON Output Testing

```typescript
it('should return valid JSON with --json flag', async () => {
    const result = await noorm('--json', 'db', 'explore')

    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)

    const json = JSON.parse(result.stdout)
    expect(json).toHaveProperty('tables')
    expect(typeof json.tables).toBe('number')
})
```


### Text Output with Color Testing

```typescript
it('should output colored text in normal mode', async () => {
    const result = await noorm('db', 'explore')

    expect(result.ok).toBe(true)
    expect(hasAnsiColors(result.stdout)).toBe(true)

    const text = stripAnsi(result.stdout)
    expect(text).toContain('Tables:')
})
```


### Error Case Testing

```typescript
it('should fail with exit code 1 on missing table', async () => {
    const result = await noorm('db', 'explore', 'tables', 'detail', '--name', 'nonexistent')

    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not found')
})
```


### Exit Code Testing

```typescript
it('should return exit code 0 on success', async () => {
    const result = await noorm('db', 'explore')
    expect(result.exitCode).toBe(0)
})

it('should return exit code 1 on failure', async () => {
    const result = await noorm('config', 'use', '--name', 'missing')
    expect(result.exitCode).toBe(1)
})
```


## Test Data Setup

Use SQLite with existing fixtures:

- Schema: `tests/fixtures/schema/sqlite/` (users, todo_lists, todo_items, views)
- Changesets: Create test changesets in `tests/fixtures/changesets/`

```typescript
beforeAll(async () => {
    // Setup test environment
    // - Create temp .noorm directory
    // - Initialize SQLite database
    // - Deploy test schema
    // - Seed test data
})

afterAll(async () => {
    // Cleanup
    // - Remove temp directories
    // - Destroy database connection
})
```


## Priority Order

1. `db/explore` commands (foundation for other tests)
2. `help` command (simple, validates CLI works)
3. `lock/*` commands (simple state machine)
4. `changeset/*` commands (core functionality)
5. `run/*` commands (schema execution)
6. `config/use` (config management)
