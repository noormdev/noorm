/**
 * noorm settings — manage project settings.yml.
 */
import { defineCommand } from 'citty';

import init from './init.js';
import build from './build.js';

export default defineCommand({
    meta: {
        name: 'settings',
        description: 'Manage project settings',
    },
    subCommands: { init, build },
});
