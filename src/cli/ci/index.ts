/**
 * noorm ci — CI/CD provisioning and runtime commands.
 *
 * Two groups:
 * - `identity` (new, enroll) — developer-run provisioning that prints
 *   env blocks for CI secrets storage.
 * - `init` / `secrets` — runtime commands that run inside a CI job
 *   against env-supplied identity + connection.
 */
import { defineCommand } from 'citty';

import identity from './identity/index.js';
import init from './init.js';
import secrets from './secrets.js';

export default defineCommand({
    meta: {
        name: 'ci',
        description: 'CI/CD provisioning and runtime commands',
    },
    subCommands: {
        identity,
        init,
        secrets,
    },
});
