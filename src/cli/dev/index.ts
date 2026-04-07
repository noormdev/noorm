/**
 * noorm dev — internal development diagnostics.
 */
import { defineCommand } from 'citty';

import testHelpers from './test-helpers.js';
import testWorkers from './test-workers.js';

export default defineCommand({
    meta: {
        name: 'dev',
        description: 'Internal development diagnostics',
    },
    subCommands: {
        'test-helpers': testHelpers,
        'test-workers': testWorkers,
    },
});
