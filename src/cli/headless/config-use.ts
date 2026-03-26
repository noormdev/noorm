import { attempt } from '@logosdx/utils';

import { initState, getStateManager } from '../../core/state/index.js';
import { syncIdentityWithConfig } from '../../core/identity/index.js';
import { outputError, outputResult, type HeadlessCommand } from './_helpers.js';

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

> The active config is stored in \`.noorm/state/state.enc\` and persists across
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

export const run: HeadlessCommand = async (params, flags, logger) => {

    const configName = params.name;

    if (!configName) {

        return outputError(flags, logger, 'Config name required. Usage: noorm -H config use <name>');

    }

    const projectRoot = process.cwd();

    const [, initErr] = await attempt(() => initState(projectRoot));

    if (initErr) {

        return outputError(flags, logger, `Failed to load state: ${initErr.message}`);

    }

    const stateManager = getStateManager(projectRoot);

    const [, setErr] = await attempt(() => stateManager.setActiveConfig(configName));

    if (setErr) {

        return outputError(flags, logger, setErr.message);

    }

    // Sync identity with the database (non-blocking)
    const config = stateManager.getConfig(configName);

    if (config) {

        const syncResult = await syncIdentityWithConfig(config);

        if (syncResult.ok && syncResult.knownUsers?.length) {

            await stateManager.addKnownUsers(syncResult.knownUsers);

        }

    }

    outputResult(flags, logger, { activeConfig: configName }, `Active config set to: ${configName}`);

    return 0;

};
