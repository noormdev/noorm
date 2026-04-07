/**
 * noorm mcp — Model Context Protocol server for AI agents.
 */
import { defineCommand } from 'citty';

import init from './init.js';
import serve from './serve.js';

export default defineCommand({
    meta: {
        name: 'mcp',
        description: 'Model Context Protocol server for AI agents',
    },
    subCommands: { init, serve },
});
