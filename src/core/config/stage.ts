import type { StageDefaults } from '../settings/types.js';
import { parseConfig } from './schema.js';
import type { Config, ConfigInput } from './types.js';

import { clampToCeiling, PROTECTED_STAGE_CEILING } from './resolver.js';

export { clampToCeiling as restrictAccess } from './resolver.js';

/** Map only fields explicitly present in stage defaults; passwords are never inherited. */
export function stageFields(defaults: StageDefaults): Partial<ConfigInput> {

    const { dialect, host, port, database, user, ssl, type, isTest, access } = defaults;
    const connection: NonNullable<ConfigInput['connection']> = {};
    if (dialect !== undefined) connection.dialect = dialect;
    if (host !== undefined) connection.host = host;
    if (port !== undefined) connection.port = port;
    if (database !== undefined) connection.database = database;
    if (user !== undefined) connection.user = user;
    if (ssl !== undefined) connection.ssl = ssl;

    return { connection, ...(type !== undefined && { type }), ...(isTest !== undefined && { isTest }), ...(access !== undefined && { access }) };

}

export function materializeStage(
    name: string,
    stageName: string,
    defaults: StageDefaults,
    overrides: Partial<ConfigInput> = {},
    password?: string,
): Config {

    const fields = stageFields(defaults);
    const connection = { host: 'localhost', database: stageName, ...fields.connection, ...overrides.connection };
    delete connection.password;
    if (password !== undefined) connection.password = password;
    const config = parseConfig({ name, type: defaults.type ?? (connection.host === 'localhost' ? 'local' : 'remote'), ...fields, ...overrides, connection });
    if (defaults.protected) config.access = clampToCeiling(config.access, PROTECTED_STAGE_CEILING);

    return config;

}
