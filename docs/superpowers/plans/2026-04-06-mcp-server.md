# noorm MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MCP server to noorm CLI so coding agents can interact with databases through noorm's multi-dialect infrastructure.

**Architecture:** Three-layer design — `src/rpc/` (transport-agnostic command registry with Zod validation, mapped to SDK/core), `src/mcp/` (MCP transport with 2 tools wrapping the RPC registry), and CLI integration (`src/cli/headless/` + `src/cli/index.tsx`).

**Tech Stack:** `@modelcontextprotocol/sdk` (MCP server + stdio), `sql-parser-cst` (SQL statement classification), `zod` (validation, already installed), Kysely + tarn (connection pooling via SDK)

**Spec:** `docs/superpowers/specs/2026-04-06-mcp-server-design.md`

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
cd /Users/alonso/projects/noorm/monorepo
bun add @modelcontextprotocol/sdk sql-parser-cst
```

- [ ] **Step 2: Verify installation**

```bash
bun run typecheck
```

Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @modelcontextprotocol/sdk and sql-parser-cst"
```

---

### Task 2: RPC Types and Registry

**Files:**
- Create: `src/rpc/types.ts`
- Create: `src/rpc/registry.ts`
- Create: `src/rpc/index.ts`
- Test: `tests/core/rpc/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/rpc/registry.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { z } from 'zod';
import { RpcRegistry } from '../../../src/rpc/registry.js';
import type { RpcCommand } from '../../../src/rpc/types.js';

describe('rpc: registry', () => {

    let registry: RpcRegistry;

    beforeEach(() => {

        registry = new RpcRegistry();

    });

    describe('register and get', () => {

        it('should register and retrieve a command', () => {

            const cmd: RpcCommand = {
                name: 'test_cmd',
                description: 'A test command',
                examples: [{ description: 'basic usage', input: { foo: 'bar' } }],
                inputSchema: z.object({ foo: z.string() }),
                handler: async () => ({ result: true }),
            };

            registry.register(cmd);

            const retrieved = registry.get('test_cmd');
            expect(retrieved).toBeDefined();
            expect(retrieved!.name).toBe('test_cmd');

        });

        it('should return undefined for unknown command', () => {

            expect(registry.get('nonexistent')).toBeUndefined();

        });

    });

    describe('list', () => {

        it('should list all registered commands', () => {

            registry.register({
                name: 'alpha',
                description: 'First command',
                examples: [],
                inputSchema: z.object({}),
                handler: async () => ({}),
            });

            registry.register({
                name: 'beta',
                description: 'Second command',
                examples: [],
                inputSchema: z.object({}),
                handler: async () => ({}),
            });

            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list[0]!.name).toBe('alpha');
            expect(list[1]!.name).toBe('beta');

        });

    });

    describe('getHelp', () => {

        it('should generate help for a registered command', () => {

            registry.register({
                name: 'sql',
                description: 'Execute a SQL query',
                examples: [
                    { description: 'simple select', input: { query: 'SELECT 1' } },
                ],
                inputSchema: z.object({
                    query: z.string().describe('The SQL query to execute'),
                }),
                handler: async () => ({}),
            });

            const help = registry.getHelp('sql');
            expect(help).toContain('sql');
            expect(help).toContain('Execute a SQL query');
            expect(help).toContain('query');
            expect(help).toContain('simple select');

        });

        it('should return undefined for unknown command', () => {

            expect(registry.getHelp('nonexistent')).toBeUndefined();

        });

    });

});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/core/rpc/registry.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create RPC types**

```typescript
// src/rpc/types.ts
import type { z } from 'zod';
import type { Context } from '../sdk/context.js';

/**
 * A registered RPC command.
 *
 * Commands are transport-agnostic — they define what operations are available,
 * validate input via Zod, and execute against SDK/core functions.
 */
export interface RpcCommand<TInput = unknown, TOutput = unknown> {
    name: string;
    description: string;
    examples: RpcExample[];
    inputSchema: z.ZodType<TInput>;
    handler: (input: TInput, session: RpcSession) => Promise<TOutput>;
}

/**
 * Session interface for RPC command handlers.
 *
 * Provides access to database connections.
 * Implemented by SessionManager in session.ts.
 */
export interface RpcSession {
    getContext(config?: string): Context;
    connect(config?: string): Promise<{ name: string; dialect: string; database: string; protected: boolean }>;
    disconnect(config?: string): Promise<void>;
    disconnectAll(): Promise<void>;
    hasConnection(config: string): boolean;
    listConnections(): string[];
}

/**
 * Example usage for a command, shown in help output.
 */
export interface RpcExample {
    description: string;
    input: Record<string, unknown>;
}

/**
 * Command summary for listing.
 */
export interface RpcCommandInfo {
    name: string;
    description: string;
}

/**
 * Error thrown by RPC command handlers.
 */
export class RpcError extends Error {

    constructor(message: string, public readonly cause?: string) {

        super(cause ? `${message}: ${cause}` : message);
        this.name = 'RpcError';

    }

}
```

- [ ] **Step 4: Create RPC registry**

```typescript
// src/rpc/registry.ts
import type { RpcCommand, RpcCommandInfo } from './types.js';

/**
 * Flat command registry.
 *
 * Stores RPC commands by name. Provides lookup, listing,
 * and help generation from command definitions and Zod schemas.
 */
export class RpcRegistry {

    #commands = new Map<string, RpcCommand>();

    /**
     * Register a command.
     */
    register(command: RpcCommand): void {

        this.#commands.set(command.name, command);

    }

    /**
     * Look up a command by name.
     */
    get(name: string): RpcCommand | undefined {

        return this.#commands.get(name);

    }

    /**
     * List all registered commands with names and descriptions.
     */
    list(): RpcCommandInfo[] {

        const entries: RpcCommandInfo[] = [];

        for (const cmd of this.#commands.values()) {

            entries.push({ name: cmd.name, description: cmd.description });

        }

        return entries;

    }

    /**
     * Generate help text for a command.
     *
     * Includes description, parameter docs from Zod schema, and examples.
     */
    getHelp(name: string): string | undefined {

        const cmd = this.#commands.get(name);

        if (!cmd) return undefined;

        const lines: string[] = [
            `# ${cmd.name}`,
            '',
            cmd.description,
            '',
        ];

        // Extract parameters from Zod schema shape
        const shape = 'shape' in cmd.inputSchema ? (cmd.inputSchema as { shape: Record<string, { description?: string; isOptional?: () => boolean }> }).shape : null;

        if (shape && Object.keys(shape).length > 0) {

            lines.push('## Parameters', '');

            for (const [key, field] of Object.entries(shape)) {

                const desc = field.description ?? '';
                const optional = typeof field.isOptional === 'function' && field.isOptional();
                const suffix = optional ? ' (optional)' : '';

                lines.push(`- **${key}**${suffix}: ${desc}`);

            }

            lines.push('');

        }

        if (cmd.examples.length > 0) {

            lines.push('## Examples', '');

            for (const example of cmd.examples) {

                lines.push(`**${example.description}:**`);
                lines.push('```json');
                lines.push(JSON.stringify(example.input, null, 4));
                lines.push('```');
                lines.push('');

            }

        }

        return lines.join('\n');

    }

}
```

- [ ] **Step 5: Create RPC index (stub — session import will resolve in Task 4)**

```typescript
// src/rpc/index.ts
export { RpcRegistry } from './registry.js';
export { RpcError } from './types.js';
export type { RpcCommand, RpcExample, RpcCommandInfo, RpcSession } from './types.js';
```

- [ ] **Step 6: Run test to verify it passes**

```bash
bun test tests/core/rpc/registry.test.ts
```

Expected: PASS — all 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/rpc/types.ts src/rpc/registry.ts src/rpc/index.ts tests/core/rpc/registry.test.ts
git commit -m "feat(rpc): add command types and flat registry"
```

---

### Task 3: SQL Protection

**Files:**
- Create: `src/rpc/protection.ts`
- Test: `tests/core/rpc/protection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/rpc/protection.test.ts
import { describe, it, expect } from 'bun:test';
import { isReadOnlyStatement } from '../../../src/rpc/protection.js';

describe('rpc: protection', () => {

    describe('isReadOnlyStatement', () => {

        // === Allowed statements ===

        it('should allow SELECT', () => {

            expect(isReadOnlyStatement('SELECT * FROM users', 'postgres')).toBe(true);

        });

        it('should allow select (lowercase)', () => {

            expect(isReadOnlyStatement('select 1', 'postgres')).toBe(true);

        });

        it('should allow EXPLAIN', () => {

            expect(isReadOnlyStatement('EXPLAIN SELECT * FROM users', 'postgres')).toBe(true);

        });

        it('should allow SHOW', () => {

            expect(isReadOnlyStatement('SHOW TABLES', 'mysql')).toBe(true);

        });

        it('should allow DESCRIBE', () => {

            expect(isReadOnlyStatement('DESCRIBE users', 'mysql')).toBe(true);

        });

        it('should allow DESC', () => {

            expect(isReadOnlyStatement('DESC users', 'mysql')).toBe(true);

        });

        it('should allow WITH ... SELECT (CTE)', () => {

            expect(isReadOnlyStatement('WITH cte AS (SELECT 1) SELECT * FROM cte', 'postgres')).toBe(true);

        });

        // === Blocked statements ===

        it('should block INSERT', () => {

            expect(isReadOnlyStatement('INSERT INTO users (name) VALUES (\'alice\')', 'postgres')).toBe(false);

        });

        it('should block UPDATE', () => {

            expect(isReadOnlyStatement('UPDATE users SET name = \'bob\'', 'postgres')).toBe(false);

        });

        it('should block DELETE', () => {

            expect(isReadOnlyStatement('DELETE FROM users', 'postgres')).toBe(false);

        });

        it('should block DROP', () => {

            expect(isReadOnlyStatement('DROP TABLE users', 'postgres')).toBe(false);

        });

        it('should block CREATE', () => {

            expect(isReadOnlyStatement('CREATE TABLE users (id INT)', 'postgres')).toBe(false);

        });

        it('should block ALTER', () => {

            expect(isReadOnlyStatement('ALTER TABLE users ADD COLUMN email TEXT', 'postgres')).toBe(false);

        });

        it('should block TRUNCATE', () => {

            expect(isReadOnlyStatement('TRUNCATE TABLE users', 'postgres')).toBe(false);

        });

        // === Edge cases ===

        it('should handle SQL with leading comments', () => {

            expect(isReadOnlyStatement('-- this is a comment\nSELECT 1', 'postgres')).toBe(true);

        });

        it('should handle SQL with block comments', () => {

            expect(isReadOnlyStatement('/* comment */ SELECT 1', 'postgres')).toBe(true);

        });

        it('should handle comment hiding a dangerous statement', () => {

            expect(isReadOnlyStatement('-- SELECT 1\nDROP TABLE users', 'postgres')).toBe(false);

        });

        it('should block multi-statement with mixed intent', () => {

            expect(isReadOnlyStatement('SELECT 1; DROP TABLE users', 'postgres')).toBe(false);

        });

        it('should allow multi-statement all SELECT', () => {

            expect(isReadOnlyStatement('SELECT 1; SELECT 2', 'postgres')).toBe(true);

        });

        it('should block WITH ... INSERT', () => {

            expect(isReadOnlyStatement('WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte', 'postgres')).toBe(false);

        });

        it('should handle empty string', () => {

            expect(isReadOnlyStatement('', 'postgres')).toBe(true);

        });

        it('should handle whitespace only', () => {

            expect(isReadOnlyStatement('   \n  ', 'postgres')).toBe(true);

        });

        // === MSSQL fallback ===

        it('should block EXEC on mssql (keyword fallback)', () => {

            expect(isReadOnlyStatement('EXEC sp_who2', 'mssql')).toBe(false);

        });

        it('should block EXECUTE on mssql', () => {

            expect(isReadOnlyStatement('EXECUTE sp_help', 'mssql')).toBe(false);

        });

        it('should allow SELECT on mssql', () => {

            expect(isReadOnlyStatement('SELECT TOP 10 * FROM users', 'mssql')).toBe(true);

        });

    });

});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/core/rpc/protection.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement protection module**

```typescript
// src/rpc/protection.ts
import { parse } from 'sql-parser-cst';
import { attempt } from '@logosdx/utils';

import type { Dialect } from '../core/connection/types.js';

/**
 * Dialect mapping from noorm to sql-parser-cst.
 */
const DIALECT_MAP: Record<Dialect, 'sqlite' | 'postgresql' | 'mysql' | 'bigquery'> = {
    sqlite: 'sqlite',
    postgres: 'postgresql',
    mysql: 'mysql',
    mssql: 'postgresql', // best-effort — fall back to keyword if parser chokes
};

/**
 * Statement types that are read-only.
 */
const READ_ONLY_STMT_TYPES: Record<string, true> = {
    select_stmt: true,
    explain_stmt: true,
    show_stmt: true,
    describe_stmt: true,
};

/**
 * Keywords that indicate a read-only statement (uppercase).
 */
const READ_ONLY_KEYWORDS: Record<string, true> = {
    SELECT: true,
    EXPLAIN: true,
    SHOW: true,
    DESCRIBE: true,
    DESC: true,
};

/**
 * Check if a SQL string contains only read-only statements.
 *
 * Strategy: try sql-parser-cst first, fall back to keyword-based
 * if the parser throws (e.g., MSSQL-specific syntax).
 */
export function isReadOnlyStatement(sql: string, dialect: Dialect): boolean {

    const trimmed = sql.trim();

    if (trimmed === '') return true;

    // Try CST parser
    const [result, err] = attempt(() =>
        parse(trimmed, {
            dialect: DIALECT_MAP[dialect],
            includeComments: false,
            includeSpaces: false,
            includeNewlines: false,
        }),
    );

    if (!err && result) {

        return isReadOnlyCst(result);

    }

    // Parser failed — fall back to keyword-based
    return isReadOnlyKeyword(trimmed);

}

/**
 * Check read-only via CST.
 */
function isReadOnlyCst(program: { statements: Array<{ type: string }> }): boolean {

    for (const stmt of program.statements) {

        if (!READ_ONLY_STMT_TYPES[stmt.type]) {

            return false;

        }

    }

    return true;

}

/**
 * Check read-only via keyword analysis.
 *
 * Strips comments, splits on semicolons, checks leading keyword.
 */
function isReadOnlyKeyword(sql: string): boolean {

    const stripped = stripComments(sql);
    const statements = stripped.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

    if (statements.length === 0) return true;

    for (const stmt of statements) {

        if (!isStatementReadOnly(stmt)) {

            return false;

        }

    }

    return true;

}

/**
 * Check if a single statement (no comments, no semicolons) is read-only.
 */
function isStatementReadOnly(stmt: string): boolean {

    const upper = stmt.toUpperCase();
    const firstWord = upper.match(/^(\w+)/)?.[1];

    if (!firstWord) return true;

    if (READ_ONLY_KEYWORDS[firstWord]) return true;

    // Handle WITH ... SELECT (CTE)
    if (firstWord === 'WITH') {

        return isCteReadOnly(upper);

    }

    return false;

}

/**
 * Check if a CTE (WITH ...) ends with a SELECT.
 *
 * Finds the last top-level keyword after all CTE definitions.
 */
function isCteReadOnly(upper: string): boolean {

    // Find the final statement after the CTE definitions.
    // CTEs are: WITH name AS (...), name AS (...) <final statement>
    // We need to find the keyword after the last closing paren at depth 0.
    let depth = 0;
    let lastCloseIdx = -1;

    for (let i = 0; i < upper.length; i++) {

        if (upper[i] === '(') depth++;
        if (upper[i] === ')') {

            depth--;

            if (depth === 0) {

                lastCloseIdx = i;

            }

        }

    }

    if (lastCloseIdx === -1) return false;

    const afterCte = upper.slice(lastCloseIdx + 1).trim();

    // Skip optional comma (recursive CTEs)
    const finalKeyword = afterCte.replace(/^,/, '').trim().match(/^(\w+)/)?.[1];

    return finalKeyword === 'SELECT';

}

/**
 * Strip SQL comments from a string.
 */
function stripComments(sql: string): string {

    // Remove block comments /* ... */
    let result = sql.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove line comments -- ...
    result = result.replace(/--[^\n]*/g, '');

    return result;

}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/core/rpc/protection.test.ts
```

Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add src/rpc/protection.ts tests/core/rpc/protection.test.ts
git commit -m "feat(rpc): add SQL protection with CST parser and keyword fallback"
```

---

### Task 4: Session Manager

**Files:**
- Create: `src/rpc/session.ts`
- Test: `tests/core/rpc/session.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/rpc/session.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { SessionManager } from '../../../src/rpc/session.js';

describe('rpc: session manager', () => {

    let session: SessionManager;

    beforeEach(() => {

        session = new SessionManager();

    });

    describe('getContext', () => {

        it('should throw when not connected', () => {

            expect(() => session.getContext('dev')).toThrow(/not connected/i);

        });

        it('should throw with config name in error', () => {

            expect(() => session.getContext('production')).toThrow(/production/);

        });

    });

    describe('hasConnection', () => {

        it('should return false when not connected', () => {

            expect(session.hasConnection('dev')).toBe(false);

        });

    });

    describe('listConnections', () => {

        it('should return empty array when no connections', () => {

            expect(session.listConnections()).toEqual([]);

        });

    });

});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/core/rpc/session.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement session manager**

```typescript
// src/rpc/session.ts
import { attempt } from '@logosdx/utils';

import { createContext, type Context } from '../sdk/index.js';
import { initState } from '../core/state/index.js';
import { RpcError, type RpcSession } from './types.js';

/**
 * Session connection info returned after connecting.
 */
export interface SessionInfo {
    name: string;
    dialect: string;
    database: string;
    protected: boolean;
}

/**
 * Manages active database connections.
 *
 * Holds Context instances keyed by config name.
 * Kysely + tarn handle connection pooling internally.
 * Implements RpcSession for use by RPC command handlers.
 */
export class SessionManager implements RpcSession {

    #contexts = new Map<string, Context>();
    #configNames = new Map<string, string>(); // resolved name for contexts connected without explicit config

    /**
     * Connect to a database configuration.
     *
     * Creates a Context, connects, and stores it.
     * If config is omitted, resolves the active config from state.
     */
    async connect(config?: string): Promise<SessionInfo> {

        const [stateManager, stateErr] = await attempt(() => initState());

        if (stateErr) {

            throw new RpcError('Failed to load state', stateErr.message);

        }

        const [ctx, ctxErr] = await attempt(() => createContext({ config }));

        if (ctxErr) {

            throw new RpcError('Failed to create context', ctxErr.message);

        }

        const [, connectErr] = await attempt(() => ctx.connect());

        if (connectErr) {

            throw new RpcError('Failed to connect', connectErr.message);

        }

        const resolvedName = ctx.noorm.config.name;

        this.#contexts.set(resolvedName, ctx);

        return {
            name: resolvedName,
            dialect: ctx.dialect,
            database: ctx.noorm.config.connection.database,
            protected: ctx.noorm.config.protected,
        };

    }

    /**
     * Disconnect from a configuration.
     *
     * If config is omitted, disconnects all active sessions.
     */
    async disconnect(config?: string): Promise<void> {

        if (!config) {

            await this.disconnectAll();
            return;

        }

        const ctx = this.#contexts.get(config);

        if (!ctx) return;

        await attempt(() => ctx.disconnect());
        this.#contexts.delete(config);

    }

    /**
     * Get the active context for a config.
     *
     * Throws if not connected.
     */
    getContext(config?: string): Context {

        if (config) {

            const ctx = this.#contexts.get(config);

            if (!ctx) {

                throw new RpcError(`Not connected to "${config}" — call connect first`);

            }

            return ctx;

        }

        // No config specified — return the only connection or error
        if (this.#contexts.size === 0) {

            throw new RpcError('Not connected — call connect first');

        }

        if (this.#contexts.size === 1) {

            return this.#contexts.values().next().value!;

        }

        const names = [...this.#contexts.keys()].join(', ');
        throw new RpcError(`Multiple connections active (${names}) — specify config`);

    }

    /**
     * Check if a connection exists for a config.
     */
    hasConnection(config: string): boolean {

        return this.#contexts.has(config);

    }

    /**
     * List active connection names.
     */
    listConnections(): string[] {

        return [...this.#contexts.keys()];

    }

    /**
     * Disconnect all active sessions.
     */
    async disconnectAll(): Promise<void> {

        for (const [name, ctx] of this.#contexts) {

            await attempt(() => ctx.disconnect());

        }

        this.#contexts.clear();

    }

}
```

- [ ] **Step 4: Update RPC index**

```typescript
// src/rpc/index.ts
export { RpcRegistry } from './registry.js';
export { SessionManager } from './session.js';
export type { SessionInfo } from './session.js';
export { RpcError } from './types.js';
export type { RpcCommand, RpcExample, RpcCommandInfo, RpcSession } from './types.js';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test tests/core/rpc/session.test.ts
```

Expected: PASS — all 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/rpc/session.ts src/rpc/index.ts tests/core/rpc/session.test.ts
git commit -m "feat(rpc): add session manager for stateful connections"
```

---

### Task 5: RPC Commands — Session and Config

**Files:**
- Create: `src/rpc/commands/session.ts`
- Create: `src/rpc/commands/config.ts`

- [ ] **Step 1: Create session commands**

```typescript
// src/rpc/commands/session.ts
import { z } from 'zod';

import type { RpcCommand } from '../types.js';
import type { RpcSession } from '../types.js';

export const sessionCommands: RpcCommand[] = [
    {
        name: 'connect',
        description: 'Connect to a database configuration. Must be called before using any database commands.',
        examples: [
            { description: 'connect to active config', input: {} },
            { description: 'connect to specific config', input: { config: 'dev' } },
        ],
        inputSchema: z.object({
            config: z.string().optional().describe('Config name to connect to. Omit to use active config.'),
        }),
        handler: async (input, session) => {

            return session.connect(input.config);

        },
    },
    {
        name: 'disconnect',
        description: 'Disconnect from a database configuration. Omit config to disconnect all.',
        examples: [
            { description: 'disconnect all', input: {} },
            { description: 'disconnect specific config', input: { config: 'dev' } },
        ],
        inputSchema: z.object({
            config: z.string().optional().describe('Config name to disconnect. Omit to disconnect all.'),
        }),
        handler: async (input, session) => {

            await session.disconnect(input.config);

            return { disconnected: true };

        },
    },
];
```

- [ ] **Step 2: Create config commands**

```typescript
// src/rpc/commands/config.ts
import { z } from 'zod';
import { attempt } from '@logosdx/utils';

import { initState } from '../../core/state/index.js';
import type { ConfigSummary } from '../../core/config/types.js';
import type { RpcCommand } from '../types.js';
import { RpcError } from '../types.js';

export const configCommands: RpcCommand[] = [
    {
        name: 'list_configs',
        description: 'List all database configurations with dialect, database name, and protection status. Does not require a database connection.',
        examples: [
            { description: 'list all configs', input: {} },
        ],
        inputSchema: z.object({}),
        handler: async (): Promise<ConfigSummary[]> => {

            const [manager, err] = await attempt(() => initState());

            if (err) {

                throw new RpcError('Failed to load state', err.message);

            }

            return manager.listConfigs();

        },
    },
];
```

- [ ] **Step 3: Verify types compile**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/rpc/commands/session.ts src/rpc/commands/config.ts
git commit -m "feat(rpc): add session and config commands"
```

---

### Task 6: RPC Commands — Explore

**Files:**
- Create: `src/rpc/commands/explore.ts`

- [ ] **Step 1: Create explore commands**

```typescript
// src/rpc/commands/explore.ts
import { z } from 'zod';

import { fetchOverview, fetchList, fetchDetail } from '../../core/explore/operations.js';
import type { ExploreCategory } from '../../core/explore/types.js';
import type { RpcCommand } from '../types.js';

const categoryEnum = z.enum([
    'tables', 'views', 'procedures', 'functions',
    'types', 'indexes', 'foreignKeys', 'triggers',
    'locks', 'connections',
]);

const detailCategoryEnum = z.enum([
    'tables', 'views', 'procedures', 'functions', 'types', 'triggers',
]);

export const exploreCommands: RpcCommand[] = [
    {
        name: 'overview',
        description: 'Get database overview with counts of all object types (tables, views, procedures, functions, types, indexes, foreign keys, triggers, locks, connections).',
        examples: [
            { description: 'get overview', input: {} },
        ],
        inputSchema: z.object({}),
        handler: async (_input, session) => {

            const ctx = session.getContext();

            return fetchOverview(ctx.kysely, ctx.dialect);

        },
    },
    {
        name: 'list',
        description: 'List database objects by category. Returns summaries with names, schemas, and category-specific metadata.',
        examples: [
            { description: 'list all tables', input: { category: 'tables' } },
            { description: 'list procedures', input: { category: 'procedures' } },
            { description: 'list foreign keys', input: { category: 'foreignKeys' } },
        ],
        inputSchema: z.object({
            category: categoryEnum.describe('Object category to list'),
        }),
        handler: async (input, session) => {

            const ctx = session.getContext();

            return fetchList(ctx.kysely, ctx.dialect, input.category as ExploreCategory);

        },
    },
    {
        name: 'detail',
        description: 'Get full detail for a specific database object. For tables: columns with types, nullability, primary key status, defaults, plus indexes and foreign keys. For procedures/functions: parameters, return type, source.',
        examples: [
            { description: 'describe a table', input: { category: 'tables', name: 'users' } },
            { description: 'describe a table in a schema', input: { category: 'tables', name: 'orders', schema: 'sales' } },
            { description: 'view procedure detail', input: { category: 'procedures', name: 'usp_GetUser' } },
        ],
        inputSchema: z.object({
            category: detailCategoryEnum.describe('Object category'),
            name: z.string().describe('Object name'),
            schema: z.string().optional().describe('Schema name (e.g., "public", "dbo")'),
        }),
        handler: async (input, session) => {

            const ctx = session.getContext();

            return fetchDetail(
                ctx.kysely,
                ctx.dialect,
                input.category as 'tables' | 'views' | 'procedures' | 'functions' | 'types' | 'triggers',
                input.name,
                input.schema,
            );

        },
    },
];
```

- [ ] **Step 2: Verify types compile**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/rpc/commands/explore.ts
git commit -m "feat(rpc): add explore commands (overview, list, detail)"
```

---

### Task 7: RPC Commands — Query, Changes, Run

**Files:**
- Create: `src/rpc/commands/query.ts`
- Create: `src/rpc/commands/changes.ts`
- Create: `src/rpc/commands/run.ts`

- [ ] **Step 1: Create query command**

```typescript
// src/rpc/commands/query.ts
import { z } from 'zod';

import { executeRawSql } from '../../core/sql-terminal/executor.js';
import type { RpcCommand } from '../types.js';
import { RpcError } from '../types.js';
import { isReadOnlyStatement } from '../protection.js';

export const queryCommands: RpcCommand[] = [
    {
        name: 'sql',
        description: 'Execute a raw SQL query. On protected configs, only SELECT, EXPLAIN, SHOW, and DESCRIBE statements are allowed.',
        examples: [
            { description: 'simple select', input: { query: 'SELECT * FROM users LIMIT 10' } },
            { description: 'count rows', input: { query: 'SELECT COUNT(*) AS total FROM orders' } },
        ],
        inputSchema: z.object({
            query: z.string().describe('The SQL query to execute'),
        }),
        handler: async (input, session) => {

            const ctx = session.getContext();
            const config = ctx.noorm.config;

            if (config.protected && !isReadOnlyStatement(input.query, ctx.dialect)) {

                throw new RpcError(
                    `Config "${config.name}" is protected — only SELECT, EXPLAIN, SHOW, and DESCRIBE are allowed`,
                );

            }

            return executeRawSql(ctx.kysely, input.query, config.name);

        },
    },
];
```

- [ ] **Step 2: Create changes commands**

```typescript
// src/rpc/commands/changes.ts
import { z } from 'zod';

import type { RpcCommand } from '../types.js';

export const changesCommands: RpcCommand[] = [
    {
        name: 'change_history',
        description: 'List applied changes with timestamps, identity, and checksums.',
        examples: [
            { description: 'get history', input: {} },
            { description: 'get last 5', input: { limit: 5 } },
        ],
        inputSchema: z.object({
            limit: z.number().int().positive().optional().describe('Max number of history records to return'),
        }),
        handler: async (input, session) => {

            const ctx = session.getContext();

            return ctx.noorm.changes.history(input.limit);

        },
    },
    {
        name: 'change_run',
        description: 'Apply a specific change by name.',
        examples: [
            { description: 'apply a change', input: { name: '2026-01-15-add-users-table' } },
        ],
        inputSchema: z.object({
            name: z.string().describe('Change name to apply'),
        }),
        handler: async (input, session) => {

            const ctx = session.getContext();

            return ctx.noorm.changes.apply(input.name);

        },
    },
    {
        name: 'change_ff',
        description: 'Fast-forward: apply all pending changes in order.',
        examples: [
            { description: 'apply all pending', input: {} },
        ],
        inputSchema: z.object({}),
        handler: async (_input, session) => {

            const ctx = session.getContext();

            return ctx.noorm.changes.ff();

        },
    },
    {
        name: 'change_revert',
        description: 'Revert a specific change by name.',
        examples: [
            { description: 'revert a change', input: { name: '2026-01-15-add-users-table' } },
        ],
        inputSchema: z.object({
            name: z.string().describe('Change name to revert'),
        }),
        handler: async (input, session) => {

            const ctx = session.getContext();

            return ctx.noorm.changes.revert(input.name);

        },
    },
];
```

- [ ] **Step 3: Create run commands**

```typescript
// src/rpc/commands/run.ts
import { z } from 'zod';

import type { RpcCommand } from '../types.js';

export const runCommands: RpcCommand[] = [
    {
        name: 'run_build',
        description: 'Build database schema from SQL files defined in settings. Applies only files that have changed since the last build (checksum-based).',
        examples: [
            { description: 'run build', input: {} },
            { description: 'force rebuild all', input: { force: true } },
        ],
        inputSchema: z.object({
            force: z.boolean().optional().describe('Skip checksum checks, rebuild everything'),
        }),
        handler: async (input, session) => {

            const ctx = session.getContext();

            return ctx.noorm.run.build({ force: input.force });

        },
    },
    {
        name: 'run_file',
        description: 'Execute a single SQL file against the database.',
        examples: [
            { description: 'run a file', input: { path: 'sql/procedures/usp_get_user.sql' } },
        ],
        inputSchema: z.object({
            path: z.string().describe('Path to the SQL file (relative to project root)'),
        }),
        handler: async (input, session) => {

            const ctx = session.getContext();

            return ctx.noorm.run.file(input.path);

        },
    },
];
```

- [ ] **Step 4: Verify types compile**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/rpc/commands/query.ts src/rpc/commands/changes.ts src/rpc/commands/run.ts
git commit -m "feat(rpc): add query, changes, and run commands"
```

---

### Task 8: RPC Command Registration

**Files:**
- Create: `src/rpc/commands/index.ts`
- Modify: `src/rpc/index.ts`

- [ ] **Step 1: Create command registration index**

```typescript
// src/rpc/commands/index.ts
import type { RpcRegistry } from '../registry.js';

import { sessionCommands } from './session.js';
import { configCommands } from './config.js';
import { exploreCommands } from './explore.js';
import { queryCommands } from './query.js';
import { changesCommands } from './changes.js';
import { runCommands } from './run.js';

/**
 * Register all RPC commands into the registry.
 */
export function registerAllCommands(registry: RpcRegistry): void {

    const allCommands = [
        ...sessionCommands,
        ...configCommands,
        ...exploreCommands,
        ...queryCommands,
        ...changesCommands,
        ...runCommands,
    ];

    for (const command of allCommands) {

        registry.register(command);

    }

}
```

- [ ] **Step 2: Update RPC index with createRegistry factory**

Replace `src/rpc/index.ts` with:

```typescript
// src/rpc/index.ts
export { RpcRegistry } from './registry.js';
export { SessionManager } from './session.js';
export { RpcError } from './types.js';
export { registerAllCommands } from './commands/index.js';
export type { RpcCommand, RpcExample, RpcCommandInfo, RpcSession } from './types.js';
export type { SessionInfo } from './session.js';

import { RpcRegistry } from './registry.js';
import { registerAllCommands } from './commands/index.js';

/**
 * Create a fully populated RPC registry.
 */
export function createRegistry(): RpcRegistry {

    const registry = new RpcRegistry();
    registerAllCommands(registry);

    return registry;

}
```

- [ ] **Step 3: Verify types compile**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/rpc/commands/index.ts src/rpc/index.ts
git commit -m "feat(rpc): register all commands and expose createRegistry"
```

---

### Task 9: MCP Server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/index.ts`

- [ ] **Step 1: Create MCP server**

```typescript
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { attempt } from '@logosdx/utils';

import type { RpcRegistry } from '../rpc/registry.js';
import type { SessionManager } from '../rpc/session.js';
import type { RpcSession } from '../rpc/types.js';

/**
 * Create the MCP server with two tools: run_noorm_cmd and noorm_help.
 */
export function createMcpServer(registry: RpcRegistry, session: SessionManager): McpServer {

    const server = new McpServer({
        name: 'noorm',
        version: '1.0.0',
    });

    // === run_noorm_cmd ===

    const runSchema = z.object({
        command: z.string().describe('Command name: "connect", "overview", "sql", "list_configs", etc.'),
        config: z.string().optional().describe('Config name for session lookup (defaults to active)'),
        payload: z.record(z.unknown()).optional().describe('Command-specific input validated against its schema'),
    });

    server.tool(
        'run_noorm_cmd',
        'Execute a noorm command. Use noorm_help to discover available commands and their parameters.',
        runSchema.shape,
        async ({ command, config, payload }) => {

            const cmd = registry.get(command);

            if (!cmd) {

                const available = registry.list().map((c) => c.name).join(', ');

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: `Unknown command: "${command}". Available: ${available}` }),
                    }],
                    isError: true,
                };

            }

            // Merge config into payload for session commands (connect/disconnect)
            // For other commands, config selects which active session to use
            const isSessionCmd = command === 'connect' || command === 'disconnect';
            let input = payload ?? {};

            if (isSessionCmd && config) {

                input = { ...input, config };

            }

            // Validate payload against command schema
            const validation = cmd.inputSchema.safeParse(input);

            if (!validation.success) {

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            error: 'Invalid payload',
                            details: validation.error.issues.map((i) => ({
                                path: i.path.join('.'),
                                message: i.message,
                            })),
                        }),
                    }],
                    isError: true,
                };

            }

            // For non-session commands, resolve context with config before calling handler
            // The handler calls session.getContext() internally — set up the right context
            const sessionForHandler = !isSessionCmd && config
                ? createConfigScopedSession(session, config)
                : session;

            const [result, err] = await attempt(
                () => cmd.handler(validation.data, sessionForHandler),
            );

            if (err) {

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: err.message, stack: err.stack }),
                    }],
                    isError: true,
                };

            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };

        },
    );

    // === noorm_help ===

    const helpSchema = z.object({
        command: z.string().optional().describe('Command name for detailed help. Omit to list all commands.'),
    });

    server.tool(
        'noorm_help',
        'Get help for noorm commands. Lists all available commands or shows detailed help for a specific command including parameters and examples.',
        helpSchema.shape,
        async ({ command }) => {

            if (command) {

                const help = registry.getHelp(command);

                if (!help) {

                    const available = registry.list().map((c) => c.name).join(', ');

                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ error: `Unknown command: "${command}". Available: ${available}` }),
                        }],
                        isError: true,
                    };

                }

                return {
                    content: [{ type: 'text' as const, text: help }],
                };

            }

            // List all commands
            const commands = registry.list();
            const lines = [
                '# noorm Commands',
                '',
                ...commands.map((c) => `- **${c.name}** — ${c.description}`),
                '',
                'Use noorm_help({ command: "<name>" }) for detailed help on a specific command.',
            ];

            return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
            };

        },
    );

    return server;

}

/**
 * Create a session proxy that scopes getContext() to a specific config.
 *
 * When the MCP envelope includes `config`, non-session commands should
 * use that config for session lookup without the command needing to know.
 */
function createConfigScopedSession(session: SessionManager, config: string): RpcSession {

    return new Proxy(session, {
        get(target, prop, receiver) {

            if (prop === 'getContext') {

                return () => target.getContext(config);

            }

            return Reflect.get(target, prop, receiver);

        },
    });

}
```

- [ ] **Step 2: Create MCP index**

```typescript
// src/mcp/index.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createRegistry, SessionManager } from '../rpc/index.js';
import { createMcpServer } from './server.js';

/**
 * Start the MCP server on stdio transport.
 *
 * This function never returns — the stdio event loop keeps the process alive.
 * Stdout is reserved for JSON-RPC. Diagnostics go to stderr.
 */
export async function startServer(): Promise<void> {

    const registry = createRegistry();
    const session = new SessionManager();
    const server = createMcpServer(registry, session);
    const transport = new StdioServerTransport();

    process.on('SIGINT', () => session.disconnectAll());
    process.on('SIGTERM', () => session.disconnectAll());

    await server.connect(transport);

    console.error('noorm MCP server running on stdio');

}
```

- [ ] **Step 3: Verify types compile**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts src/mcp/index.ts
git commit -m "feat(mcp): add MCP server with run_noorm_cmd and noorm_help tools"
```

---

### Task 10: MCP Config Init

**Files:**
- Create: `src/mcp/init.ts`
- Test: `tests/core/mcp/init.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/mcp/init.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMcpConfig } from '../../../src/mcp/init.js';

describe('mcp: init', () => {

    let tempDir: string;

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-mcp-init-'));

    });

    afterEach(async () => {

        await rm(tempDir, { recursive: true, force: true });

    });

    describe('generateMcpConfig', () => {

        it('should create .mcp.json when it does not exist', async () => {

            const result = await generateMcpConfig(tempDir);

            const content = JSON.parse(await readFile(join(tempDir, '.mcp.json'), 'utf-8'));

            expect(content.mcpServers).toBeDefined();
            expect(content.mcpServers.noorm).toBeDefined();
            expect(content.mcpServers.noorm.command).toBe('noorm');
            expect(content.mcpServers.noorm.args).toEqual(['mcp', 'serve']);
            expect(result.created).toBe(true);

        });

        it('should extend existing .mcp.json without overwriting other entries', async () => {

            await writeFile(join(tempDir, '.mcp.json'), JSON.stringify({
                mcpServers: {
                    other: { command: 'other-tool', args: ['serve'] },
                },
            }, null, 4));

            await generateMcpConfig(tempDir);

            const content = JSON.parse(await readFile(join(tempDir, '.mcp.json'), 'utf-8'));

            expect(content.mcpServers.other).toBeDefined();
            expect(content.mcpServers.other.command).toBe('other-tool');
            expect(content.mcpServers.noorm).toBeDefined();
            expect(content.mcpServers.noorm.command).toBe('noorm');

        });

        it('should write to custom path for cursor agent', async () => {

            const result = await generateMcpConfig(tempDir, { agent: 'cursor' });

            const content = JSON.parse(await readFile(join(tempDir, '.cursor', 'mcp.json'), 'utf-8'));

            expect(content.mcpServers.noorm).toBeDefined();

        });

    });

});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/core/mcp/init.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement init module**

```typescript
// src/mcp/init.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { attempt } from '@logosdx/utils';

/**
 * Agent-specific config file paths.
 */
const AGENT_PATHS: Record<string, string> = {
    claude: '.mcp.json',
    cursor: '.cursor/mcp.json',
};

/**
 * Options for config generation.
 */
export interface McpInitOptions {
    agent?: string;
}

/**
 * Result of config generation.
 */
export interface McpInitResult {
    path: string;
    created: boolean;
    extended: boolean;
}

/**
 * Generate or extend an MCP config file for a coding agent.
 *
 * Creates the file if it doesn't exist, or merges the noorm entry
 * into the existing mcpServers object without touching other entries.
 */
export async function generateMcpConfig(
    projectRoot: string,
    options: McpInitOptions = {},
): Promise<McpInitResult> {

    const agent = options.agent ?? 'claude';
    const relativePath = AGENT_PATHS[agent] ?? '.mcp.json';
    const configPath = join(projectRoot, relativePath);

    // Ensure parent directory exists
    await mkdir(dirname(configPath), { recursive: true });

    // Try to read existing file
    const [existing] = await attempt(() => readFile(configPath, 'utf-8'));

    const noormEntry = {
        command: 'noorm',
        args: ['mcp', 'serve'],
    };

    let config: Record<string, unknown>;
    let extended = false;

    if (existing) {

        config = JSON.parse(existing);
        const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
        servers.noorm = noormEntry;
        config.mcpServers = servers;
        extended = true;

    }
    else {

        config = {
            mcpServers: {
                noorm: noormEntry,
            },
        };

    }

    await writeFile(configPath, JSON.stringify(config, null, 4) + '\n');

    return {
        path: configPath,
        created: !extended,
        extended,
    };

}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/core/mcp/init.test.ts
```

Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/init.ts tests/core/mcp/init.test.ts
git commit -m "feat(mcp): add config file generation for coding agents"
```

---

### Task 11: CLI Integration — Route Types

**Files:**
- Modify: `src/cli/types.ts:14-165`

- [ ] **Step 1: Add MCP routes to Route union**

Add the following three routes to the `Route` union type in `src/cli/types.ts`, after the `dev/test-helpers` entry (line ~165) and before the closing of the type:

```typescript
    // MCP
    | 'mcp'
    | 'mcp/serve'
    | 'mcp/init'
```

- [ ] **Step 2: Verify types compile**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/types.ts
git commit -m "feat(cli): add mcp routes to Route union"
```

---

### Task 12: CLI Integration — Headless Commands

**Files:**
- Create: `src/cli/headless/mcp.ts`
- Create: `src/cli/headless/mcp-serve.ts`
- Create: `src/cli/headless/mcp-init.ts`
- Modify: `src/cli/headless/index.ts:35-149`

- [ ] **Step 1: Create mcp parent command**

```typescript
// src/cli/headless/mcp.ts
import { createHelpOnlyCommand } from './_helpers.js';

export const help = `
# MCP

Model Context Protocol server for coding agents.

## Usage

    noorm mcp [subcommand]

## Subcommands

    serve       Start the MCP server (stdio transport)
    init        Generate agent configuration files

## Description

The MCP server lets coding agents (Claude Code, Cursor, Codex, etc.)
interact with your databases through noorm. Agents can explore schemas,
run queries, manage changes, and execute SQL files.

## Quick Start

    noorm mcp init                  Generate .mcp.json
    noorm mcp serve                 Start server (agents do this automatically)

See \`noorm help mcp serve\` and \`noorm help mcp init\`.
`;

export const run = createHelpOnlyCommand(help);
```

- [ ] **Step 2: Create mcp-serve command**

```typescript
// src/cli/headless/mcp-serve.ts
import { startServer } from '../../mcp/index.js';
import type { HeadlessCommand } from './_helpers.js';

export const help = `
# MCP SERVE

Start the noorm MCP server on stdio transport.

## Usage

    noorm mcp serve

## Description

Starts a long-running MCP server that communicates via stdin/stdout
using the JSON-RPC protocol. Coding agents spawn this process
automatically when configured via \`.mcp.json\`.

This command is typically not run directly — use \`noorm mcp init\`
to generate the configuration, then your coding agent handles the rest.

## Notes

- stdout is reserved for MCP protocol — diagnostics go to stderr
- The server stays alive until the agent disconnects or the process is killed
- All database configurations are accessible via the \`config\` parameter
`;

export const run: HeadlessCommand = async () => {

    // This handler is a fallback — main() short-circuits mcp/serve
    // before runHeadless() is called. If we get here, start anyway.
    await startServer();

    return 0;

};
```

- [ ] **Step 3: Create mcp-init command**

```typescript
// src/cli/headless/mcp-init.ts
import { generateMcpConfig } from '../../mcp/init.js';
import { outputResult, outputError, type HeadlessCommand } from './_helpers.js';

export const help = `
# MCP INIT

Generate MCP configuration for your coding agent.

## Usage

    noorm mcp init [options]

## Options

    --agent NAME    Agent type: claude (default), cursor

## Description

Creates or extends a \`.mcp.json\` file in your project root so coding
agents can discover and connect to the noorm MCP server.

If the file already exists, adds the noorm entry without overwriting
other MCP server configurations.

## Examples

    noorm -H mcp init                  Generate .mcp.json (Claude Code)
    noorm -H mcp init --agent cursor   Generate .cursor/mcp.json

## JSON Output

\`\`\`json
{
    "path": "/project/.mcp.json",
    "created": true,
    "extended": false
}
\`\`\`
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const agent = typeof flags['agent'] === 'string' ? flags['agent'] : undefined;
    const projectRoot = process.cwd();

    try {

        const result = await generateMcpConfig(projectRoot, { agent });

        const action = result.created ? 'Created' : 'Extended';

        outputResult(flags, logger, result, `${action} ${result.path}`);

        return 0;

    }
    catch (err) {

        const message = err instanceof Error ? err.message : String(err);
        outputError(flags, logger, `Failed to generate MCP config: ${message}`);

        return 1;

    }

};
```

- [ ] **Step 4: Register handlers in HANDLERS registry**

In `src/cli/headless/index.ts`, add imports after the existing imports (around line 82):

```typescript
import * as CmdMcp from './mcp.js';
import * as CmdMcpServe from './mcp-serve.js';
import * as CmdMcpInit from './mcp-init.js';
```

Add entries in the `HANDLERS` object (after the `'dev/test-helpers'` entry, around line 142):

```typescript
    'mcp': CmdMcp,
    'mcp/serve': CmdMcpServe,
    'mcp/init': CmdMcpInit,
```

- [ ] **Step 5: Verify types compile**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/headless/mcp.ts src/cli/headless/mcp-serve.ts src/cli/headless/mcp-init.ts src/cli/headless/index.ts
git commit -m "feat(cli): add mcp headless commands and register in HANDLERS"
```

---

### Task 13: CLI Integration — Main Short-Circuit

**Files:**
- Modify: `src/cli/index.tsx:409-434`

- [ ] **Step 1: Add startServer import**

Add at the top of `src/cli/index.tsx`, after the existing imports (around line 31):

```typescript
import { startServer } from '../mcp/index.js';
```

- [ ] **Step 2: Add short-circuit before runHeadless**

In the `main()` function, inside the `if (mode === 'headless')` block (around line 423), add the MCP serve short-circuit **before** the `runHeadless()` call:

```typescript
        // MCP serve: short-circuit before runHeadless to keep stdout clean for JSON-RPC
        if (route === 'mcp/serve') {

            await startServer();
            process.exit(0);

        }
```

This goes after the identity check and before `const exitCode = await runHeadless(route, params, flags);`.

- [ ] **Step 3: Add mcp/init to the always-headless check**

Update the always-headless route check (around line 177) to include MCP routes:

```typescript
    if (route === 'version' || route === 'info' || route === 'mcp/serve' || route === 'mcp/init') {

        return { mode: 'headless', route, params, flags };

    }
```

- [ ] **Step 4: Verify types compile**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 5: Run existing tests to verify nothing is broken**

```bash
bun test --serial
```

Expected: All pre-existing tests pass (some SQLite-related tests may fail due to pre-existing native module issues).

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.tsx
git commit -m "feat(cli): short-circuit mcp/serve before runHeadless for stdio isolation"
```

---

### Task 14: Verification and Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Run full typecheck**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 2: Run all unit tests**

```bash
bun test tests/core/rpc/ tests/core/mcp/
```

Expected: All tests pass.

- [ ] **Step 3: Run all existing tests**

```bash
bun test --serial
```

Expected: No regressions.

- [ ] **Step 4: Verify MCP server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/cli/index.js mcp serve 2>/dev/null | head -1
```

Expected: JSON-RPC response with server capabilities. (Requires `bun run build` first.)

- [ ] **Step 5: Verify mcp init generates config**

```bash
cd /tmp && mkdir noorm-mcp-test && cd noorm-mcp-test
node /Users/alonso/projects/noorm/monorepo/dist/cli/index.js -H mcp init
cat .mcp.json
cd /tmp && rm -rf noorm-mcp-test
```

Expected: `.mcp.json` created with noorm entry.

- [ ] **Step 6: Verify help text**

```bash
node dist/cli/index.js -H help mcp
node dist/cli/index.js -H help mcp serve
node dist/cli/index.js -H help mcp init
```

Expected: Help text displayed for each command.
