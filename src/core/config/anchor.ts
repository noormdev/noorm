import { isAbsolute, join } from 'node:path';

import { SSL_FIELD_PAIRS, type ConnectionConfig } from '../connection/types.js';

/**
 * Joins relative `ssl` file paths to the project root.
 *
 * Connect-time reads resolve from the working directory, which can differ
 * from the SDK's `projectRoot`. Returns a copy; `~/` and empty paths are left
 * as written. Call after policy binding: the target identity hashes the path
 * as written.
 *
 * @example
 * anchorSslFiles({ dialect: 'postgres', database: 'app', ssl: { caFile: 'certs/ca.pem' } }, '/srv/app');
 * // ssl: { caFile: '/srv/app/certs/ca.pem' }
 */
export function anchorSslFiles(connection: ConnectionConfig, projectRoot: string): ConnectionConfig {

    const { ssl } = connection;

    if (typeof ssl !== 'object') return connection;

    const anchored = { ...ssl };

    for (const [, file] of SSL_FIELD_PAIRS) {

        const path = anchored[file];

        if (path && !isAbsolute(path) && !path.startsWith('~/')) anchored[file] = join(projectRoot, path);

    }

    return { ...connection, ssl: anchored };

}
