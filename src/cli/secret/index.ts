/**
 * noorm secret — config-scoped secret management commands.
 */
import { defineCommand } from 'citty';

import list from './list.js';
import rm from './rm.js';
import set from './set.js';

export default defineCommand({
    meta: { name: 'secret', description: 'Manage config-scoped secrets' },
    subCommands: { list, rm, set },
});
