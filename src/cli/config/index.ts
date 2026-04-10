/**
 * noorm config — manage database configurations.
 */
import { defineCommand } from 'citty';

import add from './add.js';
import edit from './edit.js';
import list from './list.js';
import rm from './rm.js';
import use from './use.js';
import validate from './validate.js';

export default defineCommand({
    meta: {
        name: 'config',
        description: 'Manage database configurations',
    },
    subCommands: { add, edit, list, rm, use, validate },
});
