/**
 * cli: an agent that shells out gets the agent role, not the human's.
 *
 * The escalation this pins was measured through the shipped binary, so this
 * reproduces it there. An agent refused a write over MCP could run the same
 * operation through `noorm` and succeed, because the CLI hardcoded the `user`
 * channel at every policy call site. On a stock config that turned deny into
 * allow for sql:write, sql:ddl, db:create, run:build and vault:read, and
 * turned db:destroy's deny into a confirm that `--yes` walks straight
 * through.
 *
 * Each case runs the *same command twice against the same config*, differing
 * only in whether the spawned environment carries an agent-harness marker.
 * The human run has to succeed and the agent run has to be refused — a fix
 * that simply broke the command would pass half of that and fail the other.
 *
 * The matrix-level property (nothing denied over MCP is reachable via the
 * CLI) lives in tests/core/policy/agent-escalation.test.ts; this file proves
 * the binary actually resolves the channel it is handed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Database } from 'bun:sqlite';

import { generateKeyPair } from '../../src/core/identity/crypto.js';
import { StateManager } from '../../src/core/state/index.js';
import type { Config } from '../../src/core/config/types.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'stock';

/**
 * The variable Claude Code exports for its own child processes — the exact
 * provenance signal `resolveChannel` keys on. Any entry from
 * `AGENT_HARNESSES` would do; one real marker keeps the test concrete.
 */
const AGENT_MARKER = 'CLAUDECODE';

describe('cli: agent channel escalation', () => {

    let tmpDir: string;
    let fakeHome: string;
    let dbPath: string;
    let privateKey: string;
    let baseEnv: Record<string, string>;

    beforeEach(async () => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-agent-channel-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-agent-channel-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

        dbPath = join(tmpDir, 'target.db');
        privateKey = generateKeyPair().privateKey;

        baseEnv = {};

        for (const [key, value] of Object.entries(process.env)) {

            if (value !== undefined && !key.startsWith('NOORM_')) baseEnv[key] = value;

        }

        Object.assign(baseEnv, {
            HOME: fakeHome,
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'CI Bot',
            NOORM_IDENTITY_EMAIL: 'ci@example.com',
        });

        await seedStockConfig();

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });

    });

    /**
     * A config with no `access` written — the shape a stock project actually
     * has on disk, and the one the escalation was measured against. Seeded
     * through StateManager because there is no headless `config add`.
     */
    async function seedStockConfig(): Promise<void> {

        const config = {
            name: CONFIG_NAME,
            type: 'local',
            isTest: true,
            connection: { dialect: 'sqlite', database: dbPath },
        } as unknown as Config;

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        await manager.setConfig(CONFIG_NAME, config);
        await manager.setActiveConfig(CONFIG_NAME);

    }

    function seedTable(): void {

        const db = new Database(dbPath);
        db.run('CREATE TABLE IF NOT EXISTS widget (id INTEGER PRIMARY KEY, name TEXT)');
        db.run("INSERT INTO widget (name) VALUES ('a')");
        db.close();

    }

    function rowCount(): number {

        const db = new Database(dbPath);
        const row = db.query('SELECT count(*) AS n FROM widget').get() as { n: number };
        db.close();

        return row.n;

    }

    /** Runs the CLI as a human operator. */
    function asHuman(args: string[]) {

        return spawnSync('node', [CLI, ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: baseEnv,
        });

    }

    /** Runs the identical command from inside an agent harness. */
    function asAgent(args: string[]) {

        return spawnSync('node', [CLI, ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: { ...baseEnv, [AGENT_MARKER]: '1' },
        });

    }

    describe('sql:write', () => {

        it('refuses an INSERT for an agent while allowing it for the human', () => {

            seedTable();

            const agent = asAgent(['sql', "INSERT INTO widget (name) VALUES ('agent')"]);

            expect(agent.status).not.toBe(0);
            expect(rowCount()).toBe(1);

            const human = asHuman(['sql', "INSERT INTO widget (name) VALUES ('human')"]);

            expect(human.status).toBe(0);
            expect(rowCount()).toBe(2);

        });

    });

    describe('sql:ddl', () => {

        it('refuses a CREATE TABLE for an agent while allowing it for the human', () => {

            seedTable();

            const agent = asAgent(['sql', 'CREATE TABLE agent_made (id INTEGER)']);

            expect(agent.status).not.toBe(0);

            const human = asHuman(['sql', 'CREATE TABLE human_made (id INTEGER)']);

            expect(human.status).toBe(0);

        });

    });

    describe('sql:read', () => {

        it('still lets an agent read — the gate restricts the role, it does not lock the agent out', () => {

            seedTable();

            const agent = asAgent(['sql', 'SELECT count(*) AS n FROM widget']);

            expect(agent.status).toBe(0);

        });

    });

    describe('db:create', () => {

        it('refuses for an agent while allowing the human', () => {

            const agent = asAgent(['db', 'create']);

            expect(agent.status).not.toBe(0);
            expect(existsSync(dbPath)).toBe(false);

            const human = asHuman(['db', 'create']);

            expect(human.status).toBe(0);
            expect(existsSync(dbPath)).toBe(true);

        });

    });

    describe('db:destroy', () => {

        it('is not satisfiable by --yes on the agent channel', () => {

            seedTable();

            // This is the shape of the original leak: db:destroy resolved to
            // `confirm` for the human's admin role, and `--yes` answers a
            // confirm. On the agent channel confirm collapses to deny before
            // --yes is ever consulted.
            const agent = asAgent(['db', 'drop', '--yes']);

            expect(agent.status).not.toBe(0);
            expect(existsSync(dbPath)).toBe(true);

        });

    });

    describe('vault:read', () => {

        it('refuses to list vault secrets for an agent', () => {

            seedTable();

            const agent = asAgent(['vault', 'list']);

            expect(agent.status).not.toBe(0);
            expect(agent.stdout + agent.stderr).toContain('vault:read');

        });

    });

    describe('NOORM_CHANNEL escape hatch', () => {

        it('lets a human scripting inside an agent session opt back in', () => {

            seedTable();

            const result = spawnSync('node', [CLI, 'sql', "INSERT INTO widget (name) VALUES ('scripted')"], {
                cwd: tmpDir,
                encoding: 'utf-8',
                env: { ...baseEnv, [AGENT_MARKER]: '1', NOORM_CHANNEL: 'user' },
            });

            expect(result.status).toBe(0);
            expect(rowCount()).toBe(2);

        });

        it('lets a caller declare the agent channel with no harness present', () => {

            seedTable();

            const result = spawnSync('node', [CLI, 'sql', "INSERT INTO widget (name) VALUES ('declared')"], {
                cwd: tmpDir,
                encoding: 'utf-8',
                env: { ...baseEnv, NOORM_CHANNEL: 'agent' },
            });

            expect(result.status).not.toBe(0);
            expect(rowCount()).toBe(1);

        });

    });

});
