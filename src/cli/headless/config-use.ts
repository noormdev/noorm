import { attempt } from '@logosdx/utils';

import { initState, getStateManager } from '../../core/state/index.js';
import { syncIdentityWithConfig } from '../../core/identity/index.js';
import { type HeadlessCommand } from './_helpers.js';

export const help = `
# CONFIG USE

Set the active configuration

## Usage

    noorm config use NAME
    noorm -H config use NAME

## Arguments

    NAME    Name of the configuration to activate

## Description

Sets the specified configuration as the active default.
Once set, commands will use this config unless overridden with \`--config\`.

> The active config is stored in \`.noorm/state.enc\` and persists across
> sessions. Headless mode respects the active config, allowing you to
> set it once and run CI commands without specifying \`--config\`.

## Examples

    noorm config use dev
    noorm -H config use production

After setting active config, these are equivalent:

    noorm -H change ff
    noorm -H --config production change ff

## JSON Output

\`\`\`json
{
    "activeConfig": "production"
}
\`\`\`

See \`noorm help config\`.
`;

export const run: HeadlessCommand = async (params, _flags, logger) => {

    const configName = params.name;

    if (!configName) {

        logger.error('Config name required. Usage: noorm -H config use <name>');

        return 1;

    }

    const projectRoot = process.cwd();

    const [, initErr] = await attempt(() => initState(projectRoot));

    if (initErr) {

        logger.error(`Failed to load state: ${initErr.message}`);

        return 1;

    }

    const stateManager = getStateManager(projectRoot);

    const [, setErr] = await attempt(() => stateManager.setActiveConfig(configName));

    if (setErr) {

        logger.error(setErr.message);

        return 1;

    }

    // Sync identity with the database (non-blocking)
    const config = stateManager.getConfig(configName);

    if (config) {

        const syncResult = await syncIdentityWithConfig(config);

        if (syncResult.ok && syncResult.knownUsers?.length) {

            await stateManager.addKnownUsers(syncResult.knownUsers);

        }

    }

    logger.info(`Active config set to: ${configName}`);

    return 0;

};
