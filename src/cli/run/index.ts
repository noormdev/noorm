/**
 * noorm run — execute SQL files and build schemas.
 */
import { defineCommand } from 'citty';

import build from './build.js';
import dir from './dir.js';
import file from './file.js';
import inspect from './inspect.js';
import preview from './preview.js';

export default defineCommand({
    meta: {
        name: 'run',
        description: 'Execute SQL files and build schemas',
    },
    subCommands: {
        build,
        dir,
        file,
        inspect,
        preview,
    },
});
