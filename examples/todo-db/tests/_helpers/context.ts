/**
 * SDK context factory for the todo-db integration tests.
 *
 * Resolves connection details from `NOORM_CONNECTION_*` env vars with the
 * docker-compose.test.yml Postgres container as a fallback (same creds as
 * `tests/utils/db.ts` in the main package). Declares `isTest: true` via the
 * mixed-case `NOORM_isTest` env var — camelCase survives the makeNestedConfig
 * lowercasing rules and maps straight onto `config.isTest`.
 */
import { createContext, type Context } from '@noormdev/sdk';

import { prepareTmpProject } from './project.js';
import type { Database, Procs, Funcs, Tvfs } from './schema.js';

export type TestContext = Context<Database, Procs, Funcs, Tvfs>;

const CONNECTION_DEFAULTS: Record<string, string> = {
    NOORM_CONNECTION_DIALECT: 'postgres',
    NOORM_CONNECTION_HOST: 'localhost',
    NOORM_CONNECTION_PORT: '15432',
    NOORM_CONNECTION_USER: 'noorm_test',
    NOORM_CONNECTION_PASSWORD: 'noorm_test',
    NOORM_CONNECTION_DATABASE: 'todo_db_example_test',
};

function primeEnv(): void {

    for (const [key, fallback] of Object.entries(CONNECTION_DEFAULTS)) {

        if (!process.env[key]) {

            process.env[key] = fallback;

        }

    }

    // Mixed-case env var keeps the key as `isTest` after makeNestedConfig
    // strips the NOORM_ prefix and applies forceAllCapToLower (all-caps-only
    // keys get lowercased; mixed case is preserved as-is).
    process.env['NOORM_isTest'] = 'true';
    process.env['NOORM_name'] = process.env['NOORM_name'] ?? 'todo_db_example_test';
    process.env['NOORM_type'] = process.env['NOORM_type'] ?? 'remote';

}

/**
 * Create a connected, test-mode SDK context against the provided project root.
 *
 * @example
 * ```ts
 * const ctx = await createTestContext();
 * await ctx.connect();
 * const users = await ctx.kysely.selectFrom('user').selectAll().execute();
 * await ctx.disconnect();
 * ```
 */
export async function createTestContext(projectRoot?: string): Promise<TestContext> {

    primeEnv();

    const root = projectRoot ?? prepareTmpProject();

    return createContext<Database, Procs, Funcs, Tvfs>({
        projectRoot: root,
        requireTest: true,
    });

}

/**
 * Resolve the connection details the tests will use. Useful for creating
 * utility connections (e.g. admin DB creation) alongside the SDK context.
 */
export function getTestConnection() {

    primeEnv();

    return {
        dialect: 'postgres' as const,
        host: process.env['NOORM_CONNECTION_HOST']!,
        port: parseInt(process.env['NOORM_CONNECTION_PORT']!, 10),
        user: process.env['NOORM_CONNECTION_USER']!,
        password: process.env['NOORM_CONNECTION_PASSWORD']!,
        database: process.env['NOORM_CONNECTION_DATABASE']!,
    };

}
