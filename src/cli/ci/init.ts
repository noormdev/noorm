/**
 * noorm ci init — bootstrap ephemeral CI state from env vars.
 *
 * Reads identity and connection from NOORM_* env vars, writes a fresh
 * state.enc, creates a config, and marks it active. Absorbs the former
 * `noorm identity ci` precheck so subsequent CLI calls in the same job
 * (run build, change ff, etc.) operate exactly as if the developer had
 * set things up manually.
 *
 * Fails fast: missing identity env → exit 1, missing connection → exit 1,
 * existing state.enc without --force → exit 1.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { loadIdentityFromEnv, CI_ENV_VARS } from '../../core/identity/env.js';
import { setKeyOverride, setIdentityOverride } from '../../core/identity/storage.js';
import { getEnvConfig } from '../../core/config/index.js';
import { parseConfig } from '../../core/config/schema.js';
import type { Config } from '../../core/config/types.js';
import type { ConnectionConfig } from '../../core/connection/types.js';
import { DEFAULT_ACCESS } from '../../core/policy/index.js';
import { initState } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

/**
 * Coerce an env-derived value back to a string.
 *
 * `getEnvConfig()` runs env vars through a parser that converts
 * numeric-looking values, so a database literally named `20240101` arrives as
 * the number 20240101. Env vars are strings by definition, and the config
 * schema requires strings, so the conversion is always an artifact.
 */
function asString(value: unknown): string | undefined {

    if (value === undefined || value === null) return undefined;

    return String(value);

}

const initCommand = defineCommand({
    meta: {
        name: 'init',
        description: 'Bootstrap ephemeral state from NOORM_* env vars (run inside CI job)',
    },
    args: {
        name: {
            type: 'string',
            description: 'Config name (default: $NOORM_CI_CONFIG_NAME or "ci")',
        },
        force: {
            type: 'boolean',
            alias: 'f',
            description: 'Overwrite existing state.enc (backs it up first)',
            default: false,
        },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const stateFile = join(projectRoot, '.noorm', 'state', 'state.enc');
        const configName = args.name || process.env['NOORM_CI_CONFIG_NAME'] || 'ci';

        // 1. Identity precheck (absorbs `noorm identity ci`)
        const envIdentity = loadIdentityFromEnv();

        if (!envIdentity) {

            const missing: string[] = [];

            if (!process.env[CI_ENV_VARS.privateKey]) missing.push(CI_ENV_VARS.privateKey);
            if (!process.env[CI_ENV_VARS.name]) missing.push(CI_ENV_VARS.name);
            if (!process.env[CI_ENV_VARS.email]) missing.push(CI_ENV_VARS.email);

            outputError(
                args,
                missing.length > 0
                    ? `Missing or invalid environment variables: ${missing.join(', ')}`
                    : `${CI_ENV_VARS.privateKey} is invalid (expected 96 hex characters of a valid X25519 PKCS8 key)`,
            );
            process.exit(EXIT.USAGE);

        }

        // 2. Connection precheck
        const [envConfig, envConfigErr] = attemptSync(() => getEnvConfig());

        if (envConfigErr) {

            outputError(args, `Invalid NOORM_CONNECTION_* env vars: ${envConfigErr.message}`);
            process.exit(EXIT.USAGE);

        }

        const { dialect, database, host, port, user, password, filename, pool, ssl } =
            envConfig.connection ?? {};

        if (!dialect) {

            outputError(args, 'NOORM_CONNECTION_DIALECT is required (postgres, mysql, sqlite, or mssql)');
            process.exit(EXIT.USAGE);

        }

        if (!database) {

            outputError(args, 'NOORM_CONNECTION_DATABASE is required');
            process.exit(EXIT.USAGE);

        }

        // 3. State.enc existence check
        let backedUpTo: string | null = null;

        if (existsSync(stateFile)) {

            if (!args.force) {

                outputError(
                    args,
                    `State already exists at ${stateFile}. Use --force to overwrite.`,
                );
                process.exit(1);

            }

            // Destroying state.enc destroys every config and every
            // config-scoped secret in this project. On an ephemeral runner
            // that is the intent, so --force alone is enough there; at an
            // interactive terminal it is far more likely to be a real project,
            // so demand --yes as well rather than break documented pipelines.
            if (process.stdin.isTTY && !args.yes) {

                outputError(
                    args,
                    `Refusing to overwrite ${stateFile} from an interactive terminal. This deletes every `
                    + 'config and config-scoped secret in this project. Pass --yes if you meant it.',
                );
                process.exit(1);

            }

            const backupPath = `${stateFile}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;

            const [, backupErr] = attemptSync(() =>
                // Owner-only: the copy holds exactly what state.enc holds.
                writeFileSync(backupPath, readFileSync(stateFile), { mode: 0o600 }),
            );

            if (backupErr) {

                outputError(
                    args,
                    `Refusing to overwrite: could not back up existing state (${backupErr.message}).`,
                );
                process.exit(1);

            }

            backedUpTo = backupPath;

            const [, rmErr] = attemptSync(() => rmSync(stateFile));

            if (rmErr) {

                outputError(args, `Failed to remove existing state: ${rmErr.message}`);
                process.exit(1);

            }

        }

        // 4. Apply env identity overrides then initialize state
        setKeyOverride(envIdentity.privateKey);
        setIdentityOverride(envIdentity.identity);

        const [stateManager, initErr] = await attempt(() => initState(projectRoot));

        if (initErr || !stateManager) {

            outputError(args, `Failed to initialize state: ${initErr?.message ?? 'unknown error'}`);
            process.exit(1);

        }

        // 5. Create config and activate
        const connection: ConnectionConfig = {
            dialect,
            database: asString(database)!,
            host: asString(host),
            port,
            user: asString(user),
            password: asString(password),
            filename: asString(filename),
            pool,
            ssl,
        };

        // Validated rather than hand-built and trusted: this is the one path
        // that writes a config nobody reviewed, and it used to persist shapes
        // the schema forbids for every later consumer to trip over.
        const [config, parseErr] = attemptSync(() => parseConfig({
            name: configName,
            type: 'remote',
            isTest: true,
            access: DEFAULT_ACCESS,
            connection,
        }) as Config);

        if (parseErr || !config) {

            outputError(args, `Invalid CI configuration: ${parseErr?.message ?? 'unknown error'}`);
            process.exit(EXIT.USAGE);

        }

        const [, setCfgErr] = await attempt(() => stateManager.setConfig(configName, config));

        if (setCfgErr) {

            outputError(args, `Failed to create config: ${setCfgErr.message}`);
            process.exit(1);

        }

        const [, setActiveErr] = await attempt(() => stateManager.setActiveConfig(configName));

        if (setActiveErr) {

            outputError(args, `Failed to set active config: ${setActiveErr.message}`);
            process.exit(1);

        }

        // 6. Output
        outputResult(
            args,
            {
                success: true,
                identity: {
                    name: envIdentity.identity.name,
                    email: envIdentity.identity.email,
                    publicKey: envIdentity.identity.publicKey,
                    identityHash: envIdentity.identity.identityHash,
                    source: 'env' as const,
                },
                config: {
                    name: configName,
                    dialect,
                    database: connection.database,
                    isTest: true,
                },
                stateFile,
                ...(backedUpTo ? { backedUpTo } : {}),
            },
            [
                'CI runtime initialized.',
                `  Identity:      ${envIdentity.identity.name} <${envIdentity.identity.email}>`,
                `  Fingerprint:   ${envIdentity.identity.identityHash}`,
                `  Config:        ${configName} (${dialect}, isTest=true)`,
                `  Database:      ${connection.database}`,
                `  State file:    ${stateFile}`,
                ...(backedUpTo ? [`  Previous state backed up to: ${backedUpTo}`] : []),
            ].join('\n'),
        );

        process.exit(0);

    },
});

(initCommand as typeof initCommand & { examples: string[] }).examples = [
    'noorm ci init',
    'noorm ci init --name staging',
    'noorm ci init --force',
];

export default initCommand;
