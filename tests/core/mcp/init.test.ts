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

            await generateMcpConfig(tempDir, { agent: 'cursor' });

            const content = JSON.parse(await readFile(join(tempDir, '.cursor', 'mcp.json'), 'utf-8'));

            expect(content.mcpServers.noorm).toBeDefined();

        });

    });

});
