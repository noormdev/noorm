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
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { loadIdentityFromEnv, CI_ENV_VARS } from '../../core/identity/env.js';
import { setKeyOverride, setIdentityOverride } from '../../core/identity/storage.js';
import { getEnvConfig } from '../../core/config/index.js';
import type { Config } from '../../core/config/types.js';
import type { ConnectionConfig } from '../../core/connection/types.js';
import { DEFAULT_ACCESS } from '../../core/policy/index.js';
import { initState } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

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
            description: 'Overwrite existing state.enc',
            default: false,
        },
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
            process.exit(1);

        }

        // 2. Connection precheck
        const [envConfig, envConfigErr] = attemptSync(() => getEnvConfig());

        if (envConfigErr) {

            outputError(args, `Invalid NOORM_CONNECTION_* env vars: ${envConfigErr.message}`);
            process.exit(1);

        }

        const { dialect, database, host, port, user, password, filename, pool, ssl } =
            envConfig.connection ?? {};

        if (!dialect) {

            outputError(args, 'NOORM_CONNECTION_DIALECT is required (postgres, mysql, sqlite, or mssql)');
            process.exit(1);

        }

        if (!database) {

            outputError(args, 'NOORM_CONNECTION_DATABASE is required');
            process.exit(1);

        }

        // 3. State.enc existence check
        if (existsSync(stateFile)) {

            if (!args.force) {

                outputError(
                    args,
                    `State already exists at ${stateFile}. Use --force to overwrite.`,
                );
                process.exit(1);

            }

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
            database,
            host,
            port,
            user,
            password,
            filename,
            pool,
            ssl,
        };

        const config: Config = {
            name: configName,
            type: 'remote',
            isTest: true,
            access: DEFAULT_ACCESS,
            connection,
        };

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
                    database,
                    isTest: true,
                },
                stateFile,
            },
            [
                'CI runtime initialized.',
                `  Identity:      ${envIdentity.identity.name} <${envIdentity.identity.email}>`,
                `  Fingerprint:   ${envIdentity.identity.identityHash}`,
                `  Config:        ${configName} (${dialect}, isTest=true)`,
                `  Database:      ${database}`,
                `  State file:    ${stateFile}`,
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
