/**
 * noorm config — manage database configurations.
 */
import { defineCommand } from 'citty';

import add from './add.js';
import cp from './cp.js';
import edit from './edit.js';
import exportCmd from './export.js';
import importCmd from './import.js';
import list from './list.js';
import rm from './rm.js';
import use from './use.js';
import validate from './validate.js';

export default defineCommand({
    meta: {
        name: 'config',
        description: 'Manage database configurations',
    },
    subCommands: { add, cp, edit, export: exportCmd, import: importCmd, list, rm, use, validate },
});
