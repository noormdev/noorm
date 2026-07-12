import { describe, it, expect } from 'bun:test';

import { createRegistry } from '../../../src/rpc/index.js';

const registry = createRegistry();

describe('rpc registry: completeness', () => {

    const expectedCommands = [
        'connect', 'disconnect', 'status',
        'list_configs',
        'overview', 'list', 'detail',
        'sql',
        'change_history', 'change_run', 'change_ff', 'change_revert',
        'run_build', 'run_file',
    ];

    it('should have all 14 commands registered', () => {

        const registered = registry.list().map(c => c.name);
        expect(registered).toHaveLength(14);

        for (const name of expectedCommands) {

            expect(registered).toContain(name);

        }

    });

    it('should have no extra unexpected commands', () => {

        const registered = registry.list().map(c => c.name);

        for (const name of registered) {

            expect(expectedCommands).toContain(name);

        }

    });

});

describe('rpc registry: schema validation — valid inputs', () => {

    const validInputs: Record<string, Record<string, unknown>> = {
        connect: {},
        disconnect: {},
        status: {},
        list_configs: {},
        overview: {},
        list: { category: 'tables' },
        detail: { category: 'tables', name: 'users' },
        sql: { query: 'SELECT 1' },
        change_history: {},
        change_run: { name: 'migration-001' },
        change_ff: {},
        change_revert: { name: 'migration-001' },
        run_build: {},
        run_file: { path: 'sql/test.sql' },
    };

    for (const [name, input] of Object.entries(validInputs)) {

        it(`${name} should accept valid input`, () => {

            const cmd = registry.get(name);
            expect(cmd).toBeDefined();

            const result = cmd!.inputSchema.safeParse(input);
            expect(result.success).toBe(true);

        });

    }

});

describe('rpc registry: schema validation — invalid inputs', () => {

    it('sql should reject missing query', () => {

        const cmd = registry.get('sql')!;
        const result = cmd.inputSchema.safeParse({});
        expect(result.success).toBe(false);

    });

    it('list should reject invalid category', () => {

        const cmd = registry.get('list')!;
        const result = cmd.inputSchema.safeParse({ category: 'invalid_category' });
        expect(result.success).toBe(false);

    });

    it('detail should reject missing name', () => {

        const cmd = registry.get('detail')!;
        const result = cmd.inputSchema.safeParse({ category: 'tables' });
        expect(result.success).toBe(false);

    });

    it('detail should reject invalid category', () => {

        const cmd = registry.get('detail')!;
        const result = cmd.inputSchema.safeParse({ category: 'indexes', name: 'test' });
        expect(result.success).toBe(false);

    });

    it('change_run should reject missing name', () => {

        const cmd = registry.get('change_run')!;
        const result = cmd.inputSchema.safeParse({});
        expect(result.success).toBe(false);

    });

    it('run_file should reject missing path', () => {

        const cmd = registry.get('run_file')!;
        const result = cmd.inputSchema.safeParse({});
        expect(result.success).toBe(false);

    });

    it('change_history should reject non-integer limit', () => {

        const cmd = registry.get('change_history')!;
        const result = cmd.inputSchema.safeParse({ limit: 3.5 });
        expect(result.success).toBe(false);

    });

    it('change_history should reject negative limit', () => {

        const cmd = registry.get('change_history')!;
        const result = cmd.inputSchema.safeParse({ limit: -1 });
        expect(result.success).toBe(false);

    });

    it('run_build should reject non-boolean force', () => {

        const cmd = registry.get('run_build')!;
        const result = cmd.inputSchema.safeParse({ force: 'yes' });
        expect(result.success).toBe(false);

    });

});

describe('rpc registry: schema validation — optional fields', () => {

    it('connect should accept config as optional', () => {

        const cmd = registry.get('connect')!;
        expect(cmd.inputSchema.safeParse({}).success).toBe(true);
        expect(cmd.inputSchema.safeParse({ config: 'dev' }).success).toBe(true);

    });

    it('detail should accept schema as optional', () => {

        const cmd = registry.get('detail')!;
        expect(cmd.inputSchema.safeParse({ category: 'tables', name: 'users' }).success).toBe(true);
        expect(cmd.inputSchema.safeParse({ category: 'tables', name: 'users', schema: 'public' }).success).toBe(true);

    });

    it('change_history should accept limit as optional', () => {

        const cmd = registry.get('change_history')!;
        expect(cmd.inputSchema.safeParse({}).success).toBe(true);
        expect(cmd.inputSchema.safeParse({ limit: 5 }).success).toBe(true);

    });

    it('run_build should accept force as optional', () => {

        const cmd = registry.get('run_build')!;
        expect(cmd.inputSchema.safeParse({}).success).toBe(true);
        expect(cmd.inputSchema.safeParse({ force: true }).success).toBe(true);

    });

});

describe('rpc registry: help generation', () => {

    it('should generate help for every registered command', () => {

        const commands = registry.list();

        for (const { name } of commands) {

            const help = registry.getHelp(name);
            expect(help).toBeDefined();
            expect(help).toContain(name);

        }

    });

    it('help should include parameter descriptions', () => {

        const help = registry.getHelp('sql')!;
        expect(help).toContain('query');
        expect(help).toContain('The SQL query to execute');

    });

    it('help should include examples', () => {

        const help = registry.getHelp('sql')!;
        expect(help).toContain('simple select');

    });

    it('help should show optional parameters', () => {

        const help = registry.getHelp('connect')!;
        expect(help).toContain('config');
        expect(help).toContain('optional');

    });

});
