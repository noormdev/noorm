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
        const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
        servers['noorm'] = noormEntry;
        config['mcpServers'] = servers;
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
