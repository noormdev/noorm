/**
 * noorm ci identity — CI identity provisioning.
 */
import { defineCommand } from 'citty';

import newCmd from './new.js';
import enroll from './enroll.js';

export default defineCommand({
    meta: {
        name: 'identity',
        description: 'CI identity provisioning',
    },
    subCommands: {
        new: newCmd,
        enroll,
    },
});
