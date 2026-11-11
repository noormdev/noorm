/** Child process for `ssl-files-home.test.ts`: resolves one caFile path and prints the outcome as JSON. */
import { attempt } from '@logosdx/utils';

import { SslFileError, resolveSslFiles } from '../../../../src/core/connection/ssl-files.js';

const [caFile] = process.argv.slice(2);

const [resolved, err] = await attempt(() => resolveSslFiles({ dialect: 'postgres', database: 'app', ssl: { caFile } }));

process.stdout.write(JSON.stringify(err instanceof SslFileError ? { code: err.code, path: err.path } : { ssl: resolved?.ssl }));
