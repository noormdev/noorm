import type { StageDefaults } from '../settings/types.js';
import { parseConfig } from './schema.js';
import type { Config, ConfigInput } from './types.js';

/** Map stage defaults to config fields; persisted materialization excludes passwords. */
export function stageFields(defaults: StageDefaults, includePassword = false): Partial<ConfigInput> {

    const { dialect, host, port, database, user, ssl, type, isTest, access } = defaults;
    const connection: NonNullable<ConfigInput['connection']> = {};

    if (dialect !== undefined) connection.dialect = dialect;
    if (host !== undefined) connection.host = host;
    if (port !== undefined) connection.port = port;
    if (database !== undefined) connection.database = database;
    if (user !== undefined) connection.user = user;
    if (ssl !== undefined) connection.ssl = ssl;
    if (includePassword && defaults.password !== undefined) connection.password = defaults.password;

    return {
        connection,
        ...(type !== undefined && { type }),
        ...(isTest !== undefined && { isTest }),
        ...(access !== undefined && { access }),
    };

}

export function materializeStage(
    name: string,
    stageName: string,
    defaults: StageDefaults,
    overrides: Pick<ConfigInput, 'connection'> = {},
    password?: string,
): Config {

    if (defaults.protected && name !== stageName) {

        throw new Error('A protected stage must use its stage name as the config name');

    }

    const fields = stageFields(defaults);
    const connection = {
        host: 'localhost',
        database: stageName,
        ...fields.connection,
        ...overrides.connection,
    };

    delete connection.password;

    if (password !== undefined) {

        connection.password = password;

    }

    return parseConfig({
        name,
        type: defaults.type ?? (connection.host === 'localhost' ? 'local' : 'remote'),
        ...fields,
        connection,
    });

}
