/**
 * noorm change — manage schema changes.
 *
 * Bare invocation renders help (citty default) — subcommands handle
 * status (`change list`), application (`change ff`, `change run`,
 * `change next`), rollback (`change revert`, `change rewind`),
 * inspection (`change history`, `change history-detail`), and
 * scaffolding (`change add`, `change edit`, `change rm`).
 */
import { defineCommand } from 'citty';

import { sharedArgs } from '../_utils.js';

import add from './add.js';
import edit from './edit.js';
import ff from './ff.js';
import list from './list.js';
import next from './next.js';
import rm from './rm.js';
import run from './run.js';
import revert from './revert.js';
import history from './history.js';
import rewind from './rewind.js';
import historyDetail from './history-detail.js';

const changeCommand = defineCommand({
    meta: {
        name: 'change',
        description: 'Manage schema changes',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    subCommands: {
        add,
        edit,
        ff,
        list,
        next,
        rm,
        run,
        revert,
        history,
        rewind,
        'history-detail': historyDetail,
    },
});

(changeCommand as typeof changeCommand & { examples: string[] }).examples = [
    'noorm change list',
    'noorm change ff',
    'noorm change run 001_users',
    'noorm change revert 001_users',
    'noorm change edit 2024-04-17-add-users-table',
];

export default changeCommand;
