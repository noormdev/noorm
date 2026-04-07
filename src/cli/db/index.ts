/**
 * noorm db — database lifecycle operations.
 */
import { defineCommand } from 'citty';

import explore from './explore.js';
import teardown from './teardown.js';
import transfer from './transfer.js';
import truncate from './truncate.js';

export default defineCommand({
    meta: {
        name: 'db',
        description: 'Database lifecycle operations',
    },
    subCommands: {
        explore,
        teardown,
        transfer,
        truncate,
    },
});
