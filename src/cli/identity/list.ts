/**
 * noorm identity list — list all known users discovered from database syncs.
 *
 * Reads encrypted project state and displays every user whose identity
 * has been synced from a connected database.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const listCommand = defineCommand({
    meta: { name: 'list', description: 'List known users discovered from database syncs' },
    args: {
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();

        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(args, `Failed to load state: ${initErr.message}`);
            process.exit(1);

        }

        const stateManager = getStateManager(projectRoot);
        const knownUsersMap = stateManager.getKnownUsers();
        const users = Object.values(knownUsersMap);

        if (users.length === 0) {

            outputResult(args, { users: [] }, 'No known users found.');
            process.exit(0);

        }

        const lines = users.map((u) =>
            `  ${u.name} <${u.email}>\n    Fingerprint: ${u.identityHash}\n    Machine:     ${u.machine}\n    Source:      ${u.source}\n    Last seen:   ${u.lastSeen}`,
        );

        outputResult(
            args,
            { users },
            `Known users (${users.length}):\n${lines.join('\n\n')}`,
        );
        process.exit(0);

    },
});

(listCommand as typeof listCommand & { examples: string[] }).examples = [
    'noorm identity list',
    'noorm identity list --json',
];

export default listCommand;
