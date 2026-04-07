/**
 * noorm change — manage schema changes.
 */
import { defineCommand } from 'citty';

import ff from './ff.js';
import run from './run.js';
import revert from './revert.js';
import history from './history.js';

export default defineCommand({
    meta: {
        name: 'change',
        description: 'Manage schema changes',
    },
    subCommands: {
        ff,
        run,
        revert,
        history,
    },
});
