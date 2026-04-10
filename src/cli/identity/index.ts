/**
 * noorm identity — manage cryptographic identity and known users.
 */
import { defineCommand } from 'citty';

import init from './init.js';
import exportKey from './export.js';
import list from './list.js';

export default defineCommand({
    meta: {
        name: 'identity',
        description: 'Manage cryptographic identity and known users',
    },
    subCommands: { init, export: exportKey, list },
});
