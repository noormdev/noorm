/**
 * noorm db explore — explore database schema.
 */
import { defineCommand } from 'citty';

import tables from './explore-tables.js';

export default defineCommand({
    meta: {
        name: 'explore',
        description: 'Explore database schema',
    },
    subCommands: { tables },
});
