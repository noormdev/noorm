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
