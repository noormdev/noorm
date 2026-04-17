/**
 * noorm settings — manage project settings.yml.
 */
import { defineCommand } from 'citty';

import init from './init.js';
import build from './build.js';
import edit from './edit.js';
import secret from './secret.js';

export default defineCommand({
    meta: {
        name: 'settings',
        description: 'Manage project settings',
    },
    subCommands: { init, build, edit, secret },
});
