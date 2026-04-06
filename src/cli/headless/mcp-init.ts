import { attempt } from '@logosdx/utils';

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

    const [result, err] = await attempt(() => generateMcpConfig(projectRoot, { agent }));

    if (err) {

        const message = err instanceof Error ? err.message : String(err);
        outputError(flags, logger, `Failed to generate MCP config: ${message}`);

        return 1;

    }

    const action = result.created ? 'Created' : 'Extended';

    outputResult(flags, logger, result, `${action} ${result.path}`);

    return 0;

};
