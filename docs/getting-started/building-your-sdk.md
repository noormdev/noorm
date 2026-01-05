# Building Your SDK


You've built your schema. Now you want to use it. This guide shows how to wrap noorm in a TypeScript SDK that provides type-safe database access across your workers, servers, and CLI tools.


## What You'll Build

A dedicated database package in your monorepo:

```
packages/
└── db/
    ├── package.json
    ├── src/
    │   ├── index.ts          # Public API
    │   ├── client.ts         # Database client
    │   ├── testing.ts        # Test utilities
    │   ├── types.ts          # Database types
    │   └── domains/          # Domain classes
    │       ├── users.ts
    │       └── posts.ts
    └── tests/                # Integration tests
```

This structure gives you:

- **Type safety** - Kysely types mirror your database
- **Testability** - Integration tests use real databases
- **Portability** - Same SDK works in workers, servers, CLI


## Step 1: Set Up the Monorepo

Create a pnpm workspace:

```bash
mkdir my-project && cd my-project
pnpm init
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
    - 'packages/*'
    - 'apps/*'
```


## Step 2: Create the Database Package

```bash
mkdir -p packages/db
cd packages/db
pnpm init
```

Update `packages/db/package.json`:

```json
{
    "name": "@my-project/db",
    "version": "1.0.0",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
        ".": "./dist/index.js",
        "./testing": "./dist/testing.js"
    },
    "scripts": {
        "build": "tsc",
        "test": "vitest run",
        "test:watch": "vitest"
    },
    "dependencies": {
        "@noormdev/sdk": "*",
        "kysely": "^0.28.0",
        "pg": "^8.16.0",
        "zod": "^3.24.0"
    },
    "devDependencies": {
        "typescript": "^5.9.0",
        "vitest": "^4.0.0"
    }
}
```


## Step 3: Define Your Types

Create `src/types.ts` with types that match your schema:

```typescript
import { z } from 'zod';

/**
 * Database type definitions matching SQL schema.
 *
 * These types are used by Kysely for type-safe queries.
 * Keep them in sync with your SQL files.
 */

export interface UsersTable {
    id: number;
    name: string;
    email: string | null;
    bio: string | null;
    created_at: Date;
}

export interface PostsTable {
    id: number;
    user_id: number;
    title: string;
    body: string | null;
    created_at: Date;
}

export interface RecentPostsView {
    id: number;
    user_id: number;
    title: string;
    body: string | null;
    created_at: Date;
    author_name: string;
}

/**
 * Complete database schema for Kysely.
 */
export interface Database {
    users: UsersTable;
    posts: PostsTable;
    recent_posts: RecentPostsView;
}

// Domain types (what comes OUT of the database)
export type User = UsersTable;
export type Post = PostsTable;
export type RecentPost = RecentPostsView;

// ─────────────────────────────────────────────────────────────
// Input Schemas (what goes INTO the database)
// ─────────────────────────────────────────────────────────────

/**
 * Define inputs as Zod schemas, then infer types from them.
 *
 * Input types differ from table types—they don't include
 * auto-generated fields like `id` or `created_at`.
 */

export const CreateUserSchema = z.object({
    name: z.string().min(1).max(255),
    email: z.string().email().optional(),
    bio: z.string().max(1000).optional(),
});

export const CreatePostSchema = z.object({
    user_id: z.number().int().positive(),
    title: z.string().min(1).max(255),
    body: z.string().max(10000).optional(),
});

// Infer input types from schemas—no duplication
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type CreatePostInput = z.infer<typeof CreatePostSchema>;
```

Zod gives you runtime validation that TypeScript can't. Never trust user input—validate it before it touches your database. This protects against malformed data, provides clear error messages, and catches mistakes that even you might make.

::: tip Type Generation
Kysely provides [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen) to automatically generate types from your database:

```bash
pnpm add -D kysely-codegen
npx kysely-codegen --dialect postgres --out-file src/types.ts
```

This introspects your database and generates accurate TypeScript types.
:::


## Step 4: Create Domain Classes

Create classes for each domain that hold a reference to the database context.

`src/domains/users.ts`:

```typescript
import type { Context } from '@noormdev/sdk';
import type { Database, User, CreateUserInput } from '../types.js';
import { CreateUserSchema } from '../types.js';

export class Users {

    #ctx: Context<Database>;

    constructor(ctx: Context<Database>) {

        this.#ctx = ctx;

    }

    async findById(id: number): Promise<User | null> {

        const result = await this.#ctx.kysely
            .selectFrom('users')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        return result ?? null;

    }

    async findByEmail(email: string): Promise<User | null> {

        const result = await this.#ctx.kysely
            .selectFrom('users')
            .selectAll()
            .where('email', '=', email)
            .executeTakeFirst();

        return result ?? null;

    }

    async create(input: CreateUserInput): Promise<User> {

        // Validate input before touching the database
        const validated = CreateUserSchema.parse(input);

        const result = await this.#ctx.kysely
            .insertInto('users')
            .values({
                name: validated.name,
                email: validated.email ?? null,
                bio: validated.bio ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return result;

    }

    async list(): Promise<User[]> {

        return this.#ctx.kysely
            .selectFrom('users')
            .selectAll()
            .orderBy('created_at', 'desc')
            .execute();

    }

}
```

`src/domains/posts.ts`:

```typescript
import type { Context } from '@noormdev/sdk';
import type { Database, Post, RecentPost, CreatePostInput } from '../types.js';
import { CreatePostSchema } from '../types.js';

export class Posts {

    #ctx: Context<Database>;

    constructor(ctx: Context<Database>) {

        this.#ctx = ctx;

    }

    async create(input: CreatePostInput): Promise<Post> {

        const validated = CreatePostSchema.parse(input);

        const result = await this.#ctx.kysely
            .insertInto('posts')
            .values({
                user_id: validated.user_id,
                title: validated.title,
                body: validated.body ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return result;

    }

    async getRecent(): Promise<RecentPost[]> {

        return this.#ctx.kysely
            .selectFrom('recent_posts')
            .selectAll()
            .orderBy('created_at', 'desc')
            .execute();

    }

    async getByUser(userId: number): Promise<Post[]> {

        return this.#ctx.kysely
            .selectFrom('posts')
            .selectAll()
            .where('user_id', '=', userId)
            .orderBy('created_at', 'desc')
            .execute();

    }

}
```


## Step 5: Create the Database Client

The client assembles all domains and exposes them as properties.

`src/client.ts`:

```typescript
import { createContext, type Context } from '@noormdev/sdk';
import type { Database } from './types.js';
import { Users } from './domains/users.js';
import { Posts } from './domains/posts.js';

export interface ClientOptions {
    config?: string;
    requireTest?: boolean;
    projectRoot?: string;
}

export class Client {

    #ctx: Context<Database>;

    readonly users: Users;
    readonly posts: Posts;

    constructor(ctx: Context<Database>) {

        this.#ctx = ctx;
        this.users = new Users(ctx);
        this.posts = new Posts(ctx);

    }

    async connect(): Promise<void> {

        await this.#ctx.connect();

    }

    async disconnect(): Promise<void> {

        await this.#ctx.disconnect();

    }

    /**
     * Reset database (teardown + build).
     */
    async reset(): Promise<void> {

        await this.#ctx.reset();

    }

    /**
     * Truncate all tables (keep schema).
     */
    async truncate(): Promise<void> {

        await this.#ctx.truncate();

    }

}

/**
 * Create a database client.
 *
 * @example
 * const db = await createClient({ config: 'dev' });
 * await db.connect();
 * const user = await db.users.findById(1);
 */
export async function createClient(options: ClientOptions = {}): Promise<Client> {

    const ctx = await createContext<Database>({
        config: options.config,
        requireTest: options.requireTest,
        projectRoot: options.projectRoot,
    });

    return new Client(ctx);

}

/**
 * Create a connected client.
 *
 * @example
 * const db = await connect({ config: 'dev' });
 * const user = await db.users.findById(1);
 */
export async function connect(options: ClientOptions = {}): Promise<Client> {

    const client = await createClient(options);
    await client.connect();

    return client;

}
```


## Step 6: Create the Public API

`src/index.ts`:

```typescript
// Client
export { Client, createClient, connect, type ClientOptions } from './client.js';

// Types
export type {
    Database,
    User,
    Post,
    RecentPost,
    CreateUserInput,
    CreatePostInput,
} from './types.js';
```


## Step 7: Add Testing Utilities

Create `src/testing.ts` for integration test helpers:

```typescript
import { createClient, Client } from './client.js';

export interface TestClientOptions {
    projectRoot?: string;
}

/**
 * Create a test database client.
 *
 * Uses requireTest: true to prevent accidentally running against production.
 *
 * @example
 * const db = await createTestClient();
 * await db.connect();
 * await db.reset();
 */
export async function createTestClient(
    options: TestClientOptions = {},
): Promise<Client> {

    return createClient({
        config: 'test',
        requireTest: true,
        projectRoot: options.projectRoot,
    });

}

/**
 * Setup hook for test suites.
 *
 * Returns connected client with clean database.
 *
 * @example
 * describe('Users', () => {
 *     let db: Client;
 *
 *     beforeAll(async () => {
 *         db = await setupTestDb();
 *     });
 *
 *     afterAll(async () => {
 *         await db.disconnect();
 *     });
 * });
 */
export async function setupTestDb(
    options: TestClientOptions = {},
): Promise<Client> {

    const db = await createTestClient(options);
    await db.connect();
    await db.reset();

    return db;

}
```


## Step 8: Write Integration Tests

By testing your SDK against a real database, you're testing your entire data layer—tables, views, stored procedures, constraints, and all. If someone changes a column type, renames a table, or breaks a view, your tests will catch it. This is how you detect schema drift before it reaches production.

Create `tests/users.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb } from '../src/testing.js';
import type { Client } from '../src/client.js';

describe('User Queries', () => {
    let db: Client;

    beforeAll(async () => {
        db = await setupTestDb();
    });

    afterAll(async () => {
        await db.disconnect();
    });

    beforeEach(async () => {
        await db.truncate();
    });

    describe('create', () => {
        it('creates a user with required fields', async () => {
            const user = await db.users.create({ name: 'Alice' });

            expect(user.id).toBeDefined();
            expect(user.name).toBe('Alice');
            expect(user.email).toBeNull();
            expect(user.created_at).toBeInstanceOf(Date);
        });

        it('creates a user with all fields', async () => {
            const user = await db.users.create({
                name: 'Bob',
                email: 'bob@example.com',
                bio: 'Hello world',
            });

            expect(user.name).toBe('Bob');
            expect(user.email).toBe('bob@example.com');
            expect(user.bio).toBe('Hello world');
        });
    });

    describe('findByEmail', () => {
        it('finds existing user', async () => {
            await db.users.create({ name: 'Alice', email: 'alice@example.com' });

            const found = await db.users.findByEmail('alice@example.com');

            expect(found).not.toBeNull();
            expect(found?.name).toBe('Alice');
        });

        it('returns null for non-existent email', async () => {
            const found = await db.users.findByEmail('nobody@example.com');

            expect(found).toBeNull();
        });
    });

    describe('list', () => {
        it('returns users in descending order by created_at', async () => {
            await db.users.create({ name: 'First' });
            await db.users.create({ name: 'Second' });

            const list = await db.users.list();

            expect(list).toHaveLength(2);
            expect(list[0].name).toBe('Second');
            expect(list[1].name).toBe('First');
        });
    });
});
```


## Step 9: Configure Test Database

The SDK uses noorm configs. You'll need a `test` config that points to your test database. Add one via noorm TUI wherever your noorm project lives:

```bash
noorm
```

Press `c` for config, `a` to add:

- **Name**: `test`
- **Database**: `my_project_test`
- **Is Test Database**: Yes


## Using Your SDK

Now you can use your SDK anywhere in the monorepo.


### In a Server

```typescript
// apps/api/src/routes/users.ts
import { connect } from '@my-project/db';

const db = await connect({ config: 'prod' });

app.get('/users', async (req, res) => {
    const list = await db.users.list();
    res.json(list);
});

app.get('/users/:id', async (req, res) => {
    const user = await db.users.findById(Number(req.params.id));
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
});
```


### In a Worker

```typescript
// apps/worker/src/jobs/send-welcome-email.ts
import { connect } from '@my-project/db';

export async function sendWelcomeEmail(userId: number) {
    const db = await connect();

    const user = await db.users.findById(userId);
    if (!user?.email) {
        console.log('User has no email, skipping');
        return;
    }

    await emailService.send({
        to: user.email,
        subject: 'Welcome!',
        body: `Hi ${user.name}, welcome aboard!`,
    });

    await db.disconnect();
}
```


### In a CLI Tool

```typescript
// apps/cli/src/commands/list-users.ts
import { connect } from '@my-project/db';

export async function listUsersCommand() {
    const db = await connect({ config: process.env.DB_CONFIG });

    const list = await db.users.list();

    console.table(list.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email ?? '(none)',
    })));

    await db.disconnect();
}
```


### In CI/CD

```yaml
# .github/workflows/test.yml
name: Tests
on: [push]

jobs:
    test:
        runs-on: ubuntu-latest
        services:
            postgres:
                image: postgres:15
                env:
                    POSTGRES_DB: test
                    POSTGRES_USER: postgres
                    POSTGRES_PASSWORD: postgres
                ports:
                    - 5432:5432

        steps:
            - uses: actions/checkout@v4
            - uses: pnpm/action-setup@v2
            - uses: actions/setup-node@v4
              with:
                  node-version: '20'
                  cache: 'pnpm'

            - run: pnpm install
            - run: pnpm --filter @my-project/db test
              env:
                  NOORM_CONNECTION_DIALECT: postgres
                  NOORM_CONNECTION_HOST: localhost
                  NOORM_CONNECTION_DATABASE: test
                  NOORM_CONNECTION_USER: postgres
                  NOORM_CONNECTION_PASSWORD: postgres
```


## Final Structure

```
my-project/
├── pnpm-workspace.yaml
├── packages/
│   └── db/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── client.ts
│       │   ├── testing.ts
│       │   ├── types.ts
│       │   └── domains/
│       │       ├── users.ts
│       │       └── posts.ts
│       └── tests/
│           └── users.test.ts
└── apps/
    ├── api/                      # Uses @my-project/db
    ├── worker/                   # Uses @my-project/db
    └── cli/                      # Uses @my-project/db
```


## What's Next?

- [SDK Reference](/reference/sdk) - Full API documentation
- [Templates](/guide/sql-files/templates) - Dynamic SQL generation
- [CI/CD Integration](/guide/ci-cd) - Headless mode for pipelines
