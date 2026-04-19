# CLI CI Identity Commands — Design


**Date:** 2026-04-19

**Status:** Draft — awaiting review

**Related specs:** Spec B (forthcoming) — `examples/todo-db/` CI wiring (workflow, tests, example cleanup) depends on the commands defined here.


## Goal

Give users a first-class path to provision and run noorm in CI environments.

Today, running noorm in CI requires the user to hand-roll an identity keypair, manually wire env vars, and find workarounds because `noorm secret set` requires existing state + an active config. There is no bridge between "developer on a laptop" and "a pipeline that just needs to run `noorm change ff`."

This spec introduces a `noorm ci` command namespace with four commands: two for **provisioning** (run once by a developer to mint CI credentials) and two for **runtime** (run inside the CI job to bootstrap and operate).


## Non-goals

- Wiring up the `examples/todo-db/` CI workflow — that lives in Spec B.
- Production CI wiring beyond the command surface (the developer-facing "how to set up prod CI" docs live in Spec B or a later docs task).
- Multi-stage CI (per-stage identities, per-stage vaults). The commands accept `--config <name>` for scoping, but the broader stage/identity model is out of scope.


## Mental model


### Two distinct use cases

**Test CI** — ephemeral, stateless, runs against a fresh Docker container. No prior vault exists. CI bootstraps identity + config + state.enc from env vars every run.

**Prod CI** — runs against a real database that already holds the `noorm` schema and vault. CI needs an identity that the prod DB recognizes so it can decrypt vault secrets. The identity must be **enrolled** in the DB's `identities` table once by a developer who already has vault access.


### Provisioning vs runtime

| Phase        | Runs where                | Commands                                            |
| ------------ | ------------------------- | --------------------------------------------------- |
| Provisioning | Developer's machine, once | `noorm ci identity new`, `noorm ci identity enroll` |
| Runtime      | Inside CI job, every run  | `noorm ci init`, `noorm ci secrets`                 |

Provisioning commands write nothing to CI — they print copy-pasteable env blocks for the developer to store in GitHub Actions secrets (or equivalent). Runtime commands read env vars and operate on ephemeral state.


## Existing infrastructure (all already implemented)

All four commands compose existing helpers. No new core modules are introduced.


### Identity

```typescript
// src/core/identity/crypto.ts
export function generateKeyPair(): { privateKey: string; publicKey: string };
export function derivePublicKeyFromPrivate(privateKeyHex: string): string;

// src/core/identity/hash.ts
export function computeIdentityHash(opts: {
    email: string; name: string; machine: string; os: string;
}): string;

// src/core/identity/env.ts
export const CI_ENV_VARS = {
    privateKey: 'NOORM_IDENTITY_PRIVATE_KEY',
    name: 'NOORM_IDENTITY_NAME',
    email: 'NOORM_IDENTITY_EMAIL',
} as const;
export function loadIdentityFromEnv(): EnvIdentityResult | null;

// src/core/identity/index.ts (re-exports from storage.ts)
export function setKeyOverride(privateKey: string): void;
export function setIdentityOverride(identity: CryptoIdentity): void;
export function clearKeyOverride(): void;
export function clearIdentityOverride(): void;
```


### Config / state

```typescript
// src/core/config/index.ts
export function getEnvConfig(): ConfigInput; // reads NOORM_CONNECTION_* env vars

// src/core/state/index.ts
export function initState(projectRoot?: string): Promise<StateManager>;
export function getStateManager(projectRoot?: string): StateManager;

// src/core/state/manager.ts — methods we use
class StateManager {
    async setConfig(name: string, config: Config): Promise<void>;
    async setActiveConfig(name: string): Promise<void>;
    async setSecret(configName: string, key: string, value: string): Promise<void>;
    getActiveConfigName(): string | null;
    async addKnownUser(user: KnownUser): Promise<void>;
}
```


### Vault propagation

```typescript
// src/core/vault/propagate.ts
export async function propagateVaultKeyTo(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    targetIdentityHash: string,
    dialect: Dialect,
): Promise<boolean>;
```


### CLI plumbing

```typescript
// src/cli/_utils.ts
export const sharedArgs = { config, json, force, dryRun, yes };
export function outputResult(args, json, text, logger?): void;
export function outputError(args, error, logger?): void;
export async function withVaultContext<T>(opts): Promise<[T, null] | [null, Error]>;
```

`withVaultContext` is the key helper for `ci identity enroll` — it hands the command a connected `ctx`, the caller's `cryptoIdentity`, and their `privateKey`, already validated against the target config's DB.


## Command surface


### 1. `noorm ci identity new`

**Purpose:** Generate a standalone x25519 keypair for a **test** CI runner. No DB contact.

**File:** `src/cli/ci/identity/new.ts`

**Imports:**

```typescript
import { defineCommand } from 'citty';

import { generateKeyPair } from '../../../core/identity/crypto.js';
import { computeIdentityHash } from '../../../core/identity/hash.js';
import { CI_ENV_VARS } from '../../../core/identity/env.js';
import { outputResult, outputError, sharedArgs } from '../../_utils.js';
```

**Args:**

- `--name <name>` (required) — display name
- `--email <email>` (required) — email
- `--json`

**Behavior:**

1. Validate `--name` and `--email` are non-empty (trim); exit 1 on failure.
2. Call `generateKeyPair()` → `{ privateKey, publicKey }`.
3. Compute `identityHash = computeIdentityHash({ email, name, machine: publicKey, os: 'env' })` — matches `loadIdentityFromEnv` shape.
4. Output:

    **Human mode (`!args.json`):**

    ```
    New CI identity generated.

      Name:        CI Bot
      Email:       ci@example.com
      Public key:  <hex>
      Fingerprint: <identityHash>

    Copy the following into your CI secrets store (e.g. GitHub Actions secrets):

      NOORM_IDENTITY_PRIVATE_KEY=<hex>
      NOORM_IDENTITY_NAME=CI Bot
      NOORM_IDENTITY_EMAIL=ci@example.com

    WARNING: the private key will not be shown again. Store it now.
    ```

    **JSON mode:**

    ```json
    {
        "name": "CI Bot",
        "email": "ci@example.com",
        "publicKey": "<hex>",
        "identityHash": "<hex>",
        "privateKey": "<hex>",
        "envBlock": {
            "NOORM_IDENTITY_PRIVATE_KEY": "<hex>",
            "NOORM_IDENTITY_NAME": "CI Bot",
            "NOORM_IDENTITY_EMAIL": "ci@example.com"
        }
    }
    ```

**Examples attached:**

```typescript
(newCommand as typeof newCommand & { examples: string[] }).examples = [
    'noorm ci identity new --name "CI Bot" --email ci@example.com',
    'noorm ci identity new --name "CI Bot" --email ci@example.com --json',
];
```


### 2. `noorm ci identity enroll`

**Purpose:** Generate (or accept) a keypair for a **prod** CI runner, register it in the target DB's `identities` table, and propagate the vault key.

**File:** `src/cli/ci/identity/enroll.ts`

**Imports:**

```typescript
import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { generateKeyPair } from '../../../core/identity/crypto.js';
import { computeIdentityHash } from '../../../core/identity/hash.js';
import { propagateVaultKeyTo } from '../../../core/vault/propagate.js';
import { decryptVaultKey } from '../../../core/vault/key.js'; // verify exact export name
import { getNoormTables, noormDb } from '../../../core/shared/tables.js';
import { withVaultContext, outputResult, outputError, sharedArgs } from '../../_utils.js';
```

**Args:**

- `--config <name>` (required) — target config; caller must have vault access
- `--name <name>` (required)
- `--email <email>` (required)
- `--public-key <hex>` (optional) — use a pre-generated public key (air-gapped flow)
- `--json`

**Behavior (sketched):**

```typescript
async run({ args }) {

    // Validation
    if (!args.name?.trim() || !args.email?.trim() || !args.config) {
        outputError(args, 'Missing required: --config, --name, --email');
        process.exit(1);
    }

    // withVaultContext enforces: state loaded, identity loaded,
    // connected, schema ensured, registerIdentity called.
    const [result, err] = await withVaultContext({
        args,
        fn: async ({ ctx, cryptoIdentity, privateKey }) => {

            // 1. Determine keypair: generated or provided
            let newPublicKey: string;
            let newPrivateKey: string | null = null;

            if (args['public-key']) {
                newPublicKey = args['public-key'];
            }
            else {
                const kp = generateKeyPair();
                newPublicKey = kp.publicKey;
                newPrivateKey = kp.privateKey;
            }

            // 2. Compute identityHash (must match what loadIdentityFromEnv
            //    will compute at runtime so CI is recognized)
            const identityHash = computeIdentityHash({
                email: args.email,
                name: args.name,
                machine: newPublicKey,
                os: 'env',
            });

            // 3. Read caller's encrypted_vault_key; decrypt with caller's
            //    privateKey. This proves caller has vault access and
            //    yields the symmetric vault key we need to propagate.
            const tables = getNoormTables(ctx.dialect);
            const ndb = noormDb(ctx.kysely, ctx.dialect);

            const callerRow = await ndb
                .selectFrom(tables.identities as keyof NoormDatabase)
                .select('encrypted_vault_key')
                .where('identity_hash', '=', cryptoIdentity.identityHash)
                .executeTakeFirst();

            if (!callerRow?.encrypted_vault_key) {
                throw new Error(
                    'You do not have vault access on this config. ' +
                    'Ask an existing vault member to run enroll for you, ' +
                    'or propagate access to your identity first.',
                );
            }

            const vaultKey = decryptVaultKey(
                JSON.parse(callerRow.encrypted_vault_key),
                privateKey,
            );

            // 4. Idempotent insert: skip if identityHash already enrolled
            const existing = await ndb
                .selectFrom(tables.identities as keyof NoormDatabase)
                .select('identity_hash')
                .where('identity_hash', '=', identityHash)
                .executeTakeFirst();

            if (!existing) {
                await ndb
                    .insertInto(tables.identities as keyof NoormDatabase)
                    .values({
                        identity_hash: identityHash,
                        public_key: newPublicKey,
                        name: args.name,
                        email: args.email,
                        encrypted_vault_key: null,
                        machine: 'ci',
                        os: 'env',
                        created_at: new Date(),
                    })
                    .execute();
            }

            // 5. Propagate vault key to new identity
            const propagated = await propagateVaultKeyTo(
                ctx.kysely,
                vaultKey,
                identityHash,
                ctx.dialect,
            );

            if (!propagated) {
                throw new Error(
                    'Enrolled identity but vault propagation failed. ' +
                    'Re-run this command to retry — it is idempotent.',
                );
            }

            return { identityHash, publicKey: newPublicKey, privateKey: newPrivateKey };
        },
    });

    if (err || !result) process.exit(1);

    // 6. Output. Private key only shown if we generated it.
    const { identityHash, publicKey, privateKey } = result;
    const hasPrivateKey = privateKey !== null;

    outputResult(
        args,
        {
            name: args.name,
            email: args.email,
            publicKey,
            identityHash,
            enrolledIn: args.config,
            ...(hasPrivateKey ? {
                privateKey,
                envBlock: {
                    NOORM_IDENTITY_PRIVATE_KEY: privateKey,
                    NOORM_IDENTITY_NAME: args.name,
                    NOORM_IDENTITY_EMAIL: args.email,
                },
            } : {}),
        },
        hasPrivateKey
            ? [ 'Enrolled new CI identity in config', args.config + '.', '', /* env block lines */ ].join('\n')
            : `Enrolled public key in config ${args.config}. Caller already holds the private key.`,
    );

    process.exit(0);
}
```

**Verify on implementation:**

- Exact export name of `decryptVaultKey` in `src/core/vault/key.ts` (mirror of `encryptVaultKey`).
- Whether the `identities` table schema has the columns as drawn above (`machine`, `os`, `created_at`, `encrypted_vault_key`). Check `src/core/shared/tables.ts`.
- Whether inserting `machine: 'ci', os: 'env'` matches the convention used when `loadIdentityFromEnv` runs on CI (both paths must produce matching `identityHash` given the same name+email+publicKey).

**Examples attached:**

```typescript
examples = [
    'noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com',
    'noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com --public-key <hex>',
    'noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com --json',
];
```


### 3. `noorm ci init`

**Purpose:** Runtime bootstrap. Validate env identity (absorbs `noorm identity ci`), write an ephemeral state.enc, create a config from env, mark it active.

**File:** `src/cli/ci/init.ts`

**Imports:**

```typescript
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { defineCommand } from 'citty';
import { attempt, attemptSync } from '@logosdx/utils';

import { loadIdentityFromEnv, CI_ENV_VARS } from '../../core/identity/env.js';
import { setKeyOverride, setIdentityOverride } from '../../core/identity/storage.js';
import { getEnvConfig } from '../../core/config/index.js';
import { initState } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
```

**Args:**

- `--name <name>` (default: `process.env.NOORM_CI_CONFIG_NAME || 'ci'`) — config name
- `--force` — overwrite existing state.enc
- `--json`

**Behavior (sketched):**

```typescript
async run({ args }) {

    const projectRoot = process.cwd();
    const stateFile = join(projectRoot, '.noorm', 'state', 'state.enc');
    const configName = args.name || process.env.NOORM_CI_CONFIG_NAME || 'ci';

    // 1. Identity precheck (absorbs `noorm identity ci`)
    const envIdentity = loadIdentityFromEnv();
    if (!envIdentity) {
        const missing = [
            !process.env[CI_ENV_VARS.privateKey] && CI_ENV_VARS.privateKey,
            !process.env[CI_ENV_VARS.name] && CI_ENV_VARS.name,
            !process.env[CI_ENV_VARS.email] && CI_ENV_VARS.email,
        ].filter(Boolean);

        outputError(
            args,
            missing.length
                ? `Missing or invalid: ${missing.join(', ')}`
                : `${CI_ENV_VARS.privateKey} is invalid (expected 96 hex chars)`,
        );
        process.exit(1);
    }

    // 2. Connection precheck
    const [envConfig, envConfigErr] = attemptSync(() => getEnvConfig());
    if (envConfigErr) {
        outputError(args, `Invalid NOORM_CONNECTION_* env vars: ${envConfigErr.message}`);
        process.exit(1);
    }
    if (!envConfig.connection?.dialect) {
        outputError(args, 'NOORM_CONNECTION_DIALECT is required');
        process.exit(1);
    }
    // Dialect-specific required fields validated downstream by setConfig's schema.

    // 3. State.enc existence check
    if (existsSync(stateFile) && !args.force) {
        outputError(
            args,
            `State already exists at ${stateFile}. Use --force to overwrite.`,
        );
        process.exit(1);
    }
    if (existsSync(stateFile) && args.force) {
        rmSync(stateFile);
    }

    // 4. Apply env identity overrides and initialize state
    setKeyOverride(envIdentity.privateKey);
    setIdentityOverride(envIdentity.identity);

    const [stateManager, initErr] = await attempt(() => initState(projectRoot));
    if (initErr) {
        outputError(args, `Failed to initialize state: ${initErr.message}`);
        process.exit(1);
    }

    // 5. Create config and activate
    const config = {
        name: configName,
        type: 'remote' as const,
        isTest: true,
        ...envConfig,
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
                source: 'env',
            },
            config: { name: configName, dialect: config.connection.dialect, isTest: true },
        },
        [
            'CI runtime initialized.',
            `  Identity:      ${envIdentity.identity.name} <${envIdentity.identity.email}>`,
            `  Fingerprint:   ${envIdentity.identity.identityHash}`,
            `  Config:        ${configName} (${config.connection.dialect}, isTest=true)`,
            `  State file:    ${stateFile}`,
        ].join('\n'),
    );

    process.exit(0);
}
```

**Verify on implementation:**

- Whether `Config` type requires additional fields beyond what `getEnvConfig` returns (e.g. `paths`, `stages`). If so, default them sensibly or let the type guide.
- Whether `StateManager.setConfig` accepts the shape above — `Config` vs `ConfigInput`. May need a small adapter.
- Whether setting identity overrides before `initState` is the correct order — based on `src/core/identity/env.ts`'s docstring ("If env identity loaded, setKeyOverride / setIdentityOverride, then proceed"), yes.

**Examples attached:**

```typescript
examples = [
    'noorm ci init',
    'noorm ci init --name staging',
    'noorm ci init --force',
];
```


### 4. `noorm ci secrets`

**Purpose:** Runtime batch-load secrets into the active config's vault. Runs after `noorm ci init`.

**File:** `src/cli/ci/secrets.ts`

**Imports:**

```typescript
import { readFile } from 'node:fs/promises';

import { defineCommand } from 'citty';
import { attempt, attemptSync } from '@logosdx/utils';

import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
```

**Args:**

- `--file <path>` (required)
- `--config <name>` (optional) — defaults to active
- `--overwrite` — overwrite existing secrets; without, existing keys are skipped
- `--json`

**File format:**

- `KEY=value`, one per line.
- Blank lines and lines starting with `#` are ignored.
- Values are literal — no shell interpolation.
- A single leading + trailing matched pair of `"` or `'` is stripped.
- Split on the first `=` only; `=` in values is permitted.

**Parser signature (local helper):**

```typescript
interface DotenvLine { key: string; value: string; lineNumber: number; }

function parseDotenv(content: string): DotenvLine[] {
    // Throws Error with lineNumber on malformed lines
}
```

**Behavior (sketched):**

```typescript
async run({ args }) {

    const projectRoot = process.cwd();

    // 1. State must exist
    const [, initErr] = await attempt(() => initState(projectRoot));
    if (initErr) {
        outputError(args, `Failed to load state (did you run "noorm ci init"?): ${initErr.message}`);
        process.exit(1);
    }
    const stateManager = getStateManager(projectRoot);
    const configName = args.config ?? stateManager.getActiveConfigName();

    if (!configName) {
        outputError(args, 'No config specified and no active config. Run "noorm ci init" or pass --config.');
        process.exit(1);
    }

    // 2. Read + parse file
    const [content, readErr] = await attempt(() => readFile(args.file, 'utf8'));
    if (readErr) {
        outputError(args, `Failed to read ${args.file}: ${readErr.message}`);
        process.exit(1);
    }

    const [lines, parseErr] = attemptSync(() => parseDotenv(content));
    if (parseErr) {
        outputError(args, `Parse error in ${args.file}: ${parseErr.message}`);
        process.exit(1);
    }

    // 3. Load existing secret keys to check collisions
    const existingConfig = stateManager.getConfig(configName);
    const existingKeys = new Set(Object.keys(existingConfig?.secrets ?? {}));

    // 4. Apply
    let setCount = 0, skippedCount = 0;
    const errors: { key: string; message: string }[] = [];

    for (const { key, value } of lines) {
        if (existingKeys.has(key) && !args.overwrite) {
            skippedCount++;
            continue;
        }

        const [, setErr] = await attempt(() => stateManager.setSecret(configName, key, value));
        if (setErr) {
            errors.push({ key, message: setErr.message });
        }
        else {
            setCount++;
        }
    }

    // 5. Output
    const summary = { set: setCount, skipped: skippedCount, errors: errors.length };

    outputResult(
        args,
        { success: errors.length === 0, config: configName, ...summary, errorDetails: errors.slice(0, 5) },
        [
            `Loaded secrets into config "${configName}".`,
            `  Set:     ${setCount}`,
            `  Skipped: ${skippedCount}${skippedCount ? ' (existing; pass --overwrite to replace)' : ''}`,
            `  Errors:  ${errors.length}`,
            ...errors.slice(0, 5).map((e) => `    - ${e.key}: ${e.message}`),
        ].join('\n'),
    );

    process.exit(errors.length === 0 ? 0 : (setCount > 0 ? 2 : 1));
}
```

**Verify on implementation:**

- Exact name of `stateManager.getConfig` — may be `getConfig` or `configs.get`. Adjust based on actual API.
- Whether `setSecret` already has idempotency or throws on duplicate — above assumes throws; if silent overwrite, the `existingKeys` check is the only gate.

**Examples attached:**

```typescript
examples = [
    'noorm ci secrets --file ./ci-secrets.env',
    'noorm ci secrets --file ./ci-secrets.env --overwrite',
    'noorm ci secrets --file ./ci-secrets.env --config prod --json',
];
```


### 5. Remove `noorm identity ci`

**Files touched:**

- **Delete** `src/cli/identity/ci.ts`
- **Edit** `src/cli/identity/index.ts`:

    ```diff
    -import ci from './ci.js';
     import init from './init.js';
     import edit from './edit.js';
     import exportKey from './export.js';
     import list from './list.js';

     export default defineCommand({
         meta: {
             name: 'identity',
             description: 'Manage cryptographic identity and known users',
         },
    -    subCommands: { ci, init, edit, export: exportKey, list },
    +    subCommands: { init, edit, export: exportKey, list },
     });
    ```

The diagnostic's semantics (validate env identity and report missing vars) are inlined into `ci init` step 1 — no shared helper needed unless we later add more CI-related sanity checks.

**Breaking change risk:** minimal. Pre-release (`alpha.32`). Only mention in `TODO.md` is the checked-off `identity ci` entry, which we'll update in the final step.


### 6. Register `ci` command group in CLI entry

**File:** `src/cli/ci/index.ts`

```typescript
import { defineCommand } from 'citty';

import init from './init.js';
import secrets from './secrets.js';
import identity from './identity/index.js';

export default defineCommand({
    meta: { name: 'ci', description: 'CI/CD provisioning and runtime commands' },
    subCommands: { init, secrets, identity },
});
```

**File:** `src/cli/ci/identity/index.ts`

```typescript
import { defineCommand } from 'citty';

import newCmd from './new.js';
import enroll from './enroll.js';

export default defineCommand({
    meta: { name: 'identity', description: 'CI identity provisioning' },
    subCommands: { new: newCmd, enroll },
});
```

**File:** `src/cli/index.ts` — edit to add the new subgroup

```diff
 import change from './change/index.js';
+import ci from './ci/index.js';
 import config from './config/index.js';
 ...
     subCommands: {
         change,
+        ci,
         config,
         ...
     },
```


## File layout (complete)

```
src/cli/ci/
├── index.ts                # ci group
├── init.ts                 # noorm ci init
├── secrets.ts              # noorm ci secrets
└── identity/
    ├── index.ts            # ci identity subgroup
    ├── new.ts              # noorm ci identity new
    └── enroll.ts           # noorm ci identity enroll
```


## Example sessions


### Test CI provisioning

```
$ noorm ci identity new --name "CI Bot" --email ci@example.com
New CI identity generated.

  Name:        CI Bot
  Email:       ci@example.com
  Public key:  7f3a...9e2b
  Fingerprint: 8d1c...2f4a

Copy the following into your CI secrets store:

  NOORM_IDENTITY_PRIVATE_KEY=4a8b...
  NOORM_IDENTITY_NAME=CI Bot
  NOORM_IDENTITY_EMAIL=ci@example.com

WARNING: the private key will not be shown again. Store it now.
```


### Inside a CI job

```
$ export NOORM_IDENTITY_PRIVATE_KEY=...
$ export NOORM_IDENTITY_NAME="CI Bot"
$ export NOORM_IDENTITY_EMAIL=ci@example.com
$ export NOORM_CONNECTION_DIALECT=postgres
$ export NOORM_CONNECTION_HOST=localhost
$ export NOORM_CONNECTION_PORT=5432
$ export NOORM_CONNECTION_DATABASE=app
$ export NOORM_CONNECTION_USER=app
$ export NOORM_CONNECTION_PASSWORD=...

$ noorm ci init
CI runtime initialized.
  Identity:      CI Bot <ci@example.com>
  Fingerprint:   8d1c...2f4a
  Config:        ci (postgres, isTest=true)
  State file:    /workspace/.noorm/state/state.enc

$ noorm ci secrets --file ./ci-secrets.env
Loaded secrets into config "ci".
  Set:     3
  Skipped: 0
  Errors:  0

$ noorm run build
$ noorm change ff
```


### Prod enrollment (developer machine)

```
$ noorm ci identity enroll --config prod --name "Prod CI" --email ci-prod@example.com
Enrolled new CI identity in config prod.

  Name:        Prod CI
  Public key:  2b1e...c7d4
  Fingerprint: 9a3f...1b2d

Copy the following into your CI secrets store:

  NOORM_IDENTITY_PRIVATE_KEY=...
  NOORM_IDENTITY_NAME=Prod CI
  NOORM_IDENTITY_EMAIL=ci-prod@example.com

WARNING: the private key will not be shown again. Store it now.
Vault access propagated successfully.
```


## Testing strategy

All tests under `tests/cli/ci/`, following repo's `bun test` convention.


### `tests/cli/ci/identity-new.test.ts`

- Happy path: run command → assert stdout contains env block, private key is 96 hex chars, public key matches `derivePublicKeyFromPrivate(privateKey)`, `identityHash` matches `computeIdentityHash({ os: 'env', machine: publicKey, ... })`.
- JSON mode: same assertions on parsed JSON.
- Missing args: no `--name` or no `--email` → exit 1, error contains the missing field.


### `tests/cli/ci/init.test.ts`

- Happy path: set all env vars, run in a clean tmp dir → state.enc exists, `initState` loads it, `getActiveConfigName()` returns the configured name, config has `isTest: true`.
- Missing identity env: exit 1, stderr names the missing var.
- Missing connection env: exit 1.
- Existing state.enc without `--force`: exit 1, message references `--force`.
- Existing state.enc with `--force`: overwrites, happy path assertions hold.
- `--name custom`: config name in state equals `custom`.


### `tests/cli/ci/secrets.test.ts`

- Happy path: after `ci init`, write a `secrets.env` with 3 keys → run → assert all 3 set via `getStateManager().getConfig(name).secrets`.
- Missing state: no prior init → exit 1, message references `ci init`.
- Malformed file: line without `=` → exit 1, message cites line number.
- Existing key without `--overwrite`: skipped, exit 0.
- Existing key with `--overwrite`: overwritten, exit 0.
- Partial failure: mock `setSecret` to throw on one key → exit 2, some set + some errored.
- Quoted values: `KEY="value with spaces"` → stored as `value with spaces`.
- Values containing `=`: `URL=https://a.b/?x=1` → stored as `https://a.b/?x=1`.


### `tests/cli/ci/identity-enroll.test.ts`

Integration-style (uses existing Docker postgres fixture pattern). Cover:

- Happy path (generated key): caller has vault access → run enroll → DB has new identity row → `encrypted_vault_key` populated → private key is in stdout.
- Happy path (`--public-key`): new identity row exists, no private key in stdout.
- Caller lacks vault access: caller identity has `encrypted_vault_key = null` → exit 1, no row inserted.
- Idempotent re-enrollment: run twice → second run does not error, row still exists, propagation re-runs safely.
- Missing `--config`: exit 1.


## Error handling

All commands use the repo's error-tuple pattern (`attempt` / `attemptSync`), never try/catch. Exit codes:

- `0` — success
- `1` — precondition failure (missing args, missing env, missing state, DB unreachable)
- `2` — partial failure (`ci secrets` only, when some secrets load and some fail — lets CI detect degraded state)


## Open questions (resolvable during implementation)

1. **`isTest` for prod CI.** `ci init` defaults to `isTest: true` since test CI is primary. Prod CI runners want `isTest: false`. Resolution: add an env var `NOORM_CI_IS_TEST` (default `true`) and/or a `--no-test` flag. Decide when wiring; spec allows either.
2. **`setConfig` input shape.** `getEnvConfig()` returns a partial `ConfigInput`; `StateManager.setConfig` may require additional fields (`paths`, `stages`). Fill with sensible defaults during implementation.
3. **`decryptVaultKey` export name.** Spec assumes it exists in `src/core/vault/key.ts` as the inverse of `encryptVaultKey`. Verify on implementation; if not exported, extract it.
4. **`identities` table columns.** Spec assumes `machine`, `os`, `created_at` exist on the insert. Verify against `src/core/shared/tables.ts`; if naming differs, adjust.


## Implementation order

1. Scaffold: `src/cli/ci/index.ts`, `src/cli/ci/identity/index.ts` (empty subgroups first — they don't need to be registered in `src/cli/index.ts` until at least one subcommand exists).
2. `noorm ci identity new` — no DB, simplest. Register the `ci` group in `src/cli/index.ts` at this step.
3. `noorm ci init` — no DB, env-only.
4. `noorm ci secrets` — reuses `ci init` output, no DB.
5. `noorm ci identity enroll` — DB-touching; requires Docker fixture in tests.
6. Remove `noorm identity ci`: delete `src/cli/identity/ci.ts`, edit `src/cli/identity/index.ts`.
7. Write all four test files.
8. Update `TODO.md`: remove the stale `identity ci` line from the TUI Parity Gaps section; add four new checked entries under a "CI commands" sub-section or similar.


## TODO.md changes

Replace existing entry:

```diff
-- [x] **`identity ci`** - Create/load an identity for CI use via ENV variables (e.g. `NOORM_IDENTITY_PRIVATE_KEY`, `NOORM_IDENTITY_NAME`, `NOORM_IDENTITY_EMAIL`). Requires **core support** to bootstrap an identity from env vars instead of `~/.noorm/identity` on disk, so CI runners can decrypt vault/state without writing secrets to the filesystem.
+- [x] **CI provisioning + runtime** — full `noorm ci` namespace for CI/CD:
+    - `noorm ci identity new` — generate a local keypair + env block for test CI
+    - `noorm ci identity enroll --config <name>` — generate + register identity in a prod DB's `identities` table with vault propagation
+    - `noorm ci init` — bootstrap ephemeral state.enc from env vars (identity + connection)
+    - `noorm ci secrets --file <path>` — batch-load secrets from dotenv file into active config's vault
+    - Absorbs and removes the former `noorm identity ci` diagnostic
```


## Out of scope (deferred to Spec B)

- `examples/todo-db/.noorm/settings.yml` cleanup.
- `.gitignore` and `git rm` for tracked state history.
- `.github/workflows/example-todo-db.yml`.
- SDK tests at `examples/todo-db/tests/`.
- Generating the actual CI identity for the todo-db example and storing it in GitHub Actions secrets.
