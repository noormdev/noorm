/**
 * noorm db — database lifecycle operations.
 */
import { defineCommand } from 'citty';

import create from './create.js';
import drop from './drop.js';
import explore from './explore.js';
import reset from './reset.js';
import teardown from './teardown.js';
import transfer from './transfer.js';
import truncate from './truncate.js';

export default defineCommand({
    meta: {
        name: 'db',
        description: 'Database lifecycle operations',
    },
    subCommands: {
        create,
        drop,
        explore,
        reset,
        teardown,
        transfer,
        truncate,
    },
});
