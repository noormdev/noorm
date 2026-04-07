/**
 * noorm lock — distributed lock management.
 */
import { defineCommand } from 'citty';

import acquire from './acquire.js';
import force from './force.js';
import release from './release.js';
import status from './status.js';

export default defineCommand({
    meta: {
        name: 'lock',
        description: 'Distributed lock operations',
    },
    subCommands: {
        acquire,
        force,
        release,
        status,
    },
});
