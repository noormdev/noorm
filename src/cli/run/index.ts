/**
 * noorm run — execute SQL files and build schemas.
 */
import { defineCommand } from 'citty';

import build from './build.js';
import dir from './dir.js';
import exec from './exec.js';
import file from './file.js';
import files from './files.js';
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
        exec,
        file,
        files,
        inspect,
        preview,
    },
});
