import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import { SSL_FIELD_PAIRS } from './types.js';
import type { ConnectionConfig } from './types.js';

const MAX_FILE_BYTES = 1024 * 1024;

const PEM_BLOCK = /^\uFEFF?-----BEGIN /m;

/**
 * An ssl file that could not be read.
 *
 * Carries the field, the path and the system error code, never file content:
 * a `keyFile` may point at any file the process can read, and the message
 * reaches events and agent-channel output.
 *
 * @example
 * if (err instanceof SslFileError) console.error(err.field, err.path, err.code);
 */
export class SslFileError extends Error {

    override readonly name = 'SslFileError' as const;

    constructor(
        public readonly field: string,
        public readonly path: string,
        public readonly code: string,
    ) {

        super(messageFor(field, path, code));

    }

}

/**
 * Return a connection whose ssl file fields are read into their inline fields.
 *
 * Runs on every connect attempt, so the dialects see PEM text only and a rotated
 * certificate takes effect without a config change. Async so a path that
 * blocks (a FIFO) cannot freeze the event loop past an abort; anything that
 * is not a non-empty regular file of at most 1 MiB is refused before it is read, and a file
 * of only whitespace or holding no PEM block is refused after.
 *
 * Never mutates its input: the resolved PEM lives on the returned copy, so
 * the stored config, and anything that redacts or exports it, keeps paths.
 * A relative path resolves from the working directory; a leading `~/` from
 * the home directory.
 *
 * @example
 * const resolved = await resolveSslFiles({ ...config, ssl: { caFile: './certs/ca.pem' } });
 * // resolved.ssl is { ca: '<PEM text>' }
 */
export async function resolveSslFiles(config: ConnectionConfig): Promise<ConnectionConfig> {

    const { ssl } = config;

    if (config.dialect === 'sqlite' || !ssl || typeof ssl === 'boolean') return config;

    const resolved = { ...ssl };

    for (const [inline, file] of SSL_FIELD_PAIRS) {

        const written = ssl[file];

        if (written === undefined) continue;

        const path = written.startsWith('~/') ? join(homedir(), written.slice(2)) : written;

        const field = `ssl.${file}`;
        const [info, statErr] = await attempt(() => stat(path));

        if (statErr) throw new SslFileError(field, path, errorCode(statErr));
        if (!info.isFile()) throw new SslFileError(field, path, 'EINVAL');
        if (info.size === 0) throw new SslFileError(field, path, 'EMPTY');
        if (info.size > MAX_FILE_BYTES) throw new SslFileError(field, path, 'EFBIG');

        const [content, err] = await attempt(() => readFile(path, 'utf8'));

        if (err) throw new SslFileError(field, path, errorCode(err));
        if (content.trim().length === 0) throw new SslFileError(field, path, 'EMPTY');
        if (!PEM_BLOCK.test(content)) throw new SslFileError(field, path, 'ENOTPEM');

        delete resolved[file];
        resolved[inline] = content;

    }

    return { ...config, ssl: resolved };

}

function messageFor(field: string, path: string, code: string): string {

    if (code === 'EINVAL') return `${field} '${path}' is not a regular file`;
    if (code === 'EMPTY') return `${field} '${path}' is empty`;
    if (code === 'EFBIG') return `${field} '${path}' is larger than 1 MiB`;
    if (code === 'ENOTPEM') return `${field} '${path}' is not a PEM file`;

    return `Cannot read ${field} '${path}': ${code}`;

}

const SSL_FILE_MESSAGE = /^(?:Connection failed: )?(?:Cannot read )?ssl\.(?:ca|cert|key)File '/;

/** Whether a string is an `SslFileError` message, for callers that hold only the text; change it together with `messageFor`.
 * @example if (isSslFileErrorMessage(connectionError)) return false; // not a missing database */
export function isSslFileErrorMessage(message: string): boolean {

    return SSL_FILE_MESSAGE.test(message);

}

function errorCode(err: Error): string {

    const code: unknown = Reflect.get(err, 'code');

    return typeof code === 'string' ? code : 'UNKNOWN';

}
