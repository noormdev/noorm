/**
 * noorm mcp init — generate MCP configuration for a coding agent.
 *
 * Creates or extends a .mcp.json (or .cursor/mcp.json) file so the
 * agent can discover and connect to the noorm MCP server automatically.
 */
import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { generateMcpConfig } from '../../mcp/init.js';
import { outputResult, outputError } from '../_utils.js';

const initCommand = defineCommand({
    meta: {
        name: 'init',
        description: 'Generate MCP configuration for a coding agent',
    },
    args: {
        agent: {
            type: 'string',
            description: 'Agent type: claude (default), cursor',
        },
        json: {
            type: 'boolean',
            description: 'Output JSON',
        },
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const agent = args.agent ?? undefined;

        const [result, err] = await attempt(() => generateMcpConfig(projectRoot, { agent }));

        if (err) {

            outputError(args, `Failed to generate MCP config: ${err.message}`);
            process.exit(1);

        }

        const action = result.created ? 'Created' : 'Extended';

        outputResult(args, result, `${action} ${result.path}`);

        process.exit(0);

    },
});

(initCommand as typeof initCommand & { examples: string[] }).examples = [
    'noorm mcp init',
    'noorm mcp init --agent cursor',
    'noorm mcp init --json',
];

export default initCommand;
