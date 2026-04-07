/**
 * noorm vault — encrypted secret storage commands.
 */
import { defineCommand } from 'citty';

import cp from './cp.js';
import init from './init.js';
import list from './list.js';
import propagate from './propagate.js';
import rm from './rm.js';
import set from './set.js';

export default defineCommand({
    meta: { name: 'vault', description: 'Encrypted secret storage' },
    subCommands: { cp, init, list, propagate, rm, set },
});
