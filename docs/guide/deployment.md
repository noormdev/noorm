# Deploying an Application


On your laptop, `createContext({ config: 'dev' })` works because two things are sitting on disk: an encrypted `.noorm/state/state.enc` holding your configs, and an identity keypair in `~/.noorm/`. Neither belongs in a production image. You do not want your team's staging credentials baked into a container, and you certainly do not want a developer's private key there.

The good news is that noorm already runs without either. The mode CI uses — configuration from environment variables alone — is the same mode your application should use in production. This guide covers what changes between the laptop and the cluster.


## Split the job in two

Most deployment pain comes from treating "get the schema up to date" and "serve traffic" as one step. They have opposite requirements:

|  | Schema delivery | Application runtime |
|---|---|---|
| **Runs** | Once per release | In every replica, continuously |
| **Needs** | Write access, your `sql/` and `changes/` directories | A connection and nothing else |
| **Scales** | Exactly one at a time | Horizontally, to N replicas |
| **Surface** | `noorm run build`, `noorm change ff` | `createContext()` |

Keep them apart and horizontal scaling is uneventful. Fold schema delivery into application boot and every new replica becomes a schema-mutating process racing its siblings.


## Runtime: connect from the environment

When no stored config is in play and `NOORM_CONNECTION_DIALECT` and `NOORM_CONNECTION_DATABASE` are both set, `createContext()` builds a config from the environment alone. No project directory, no identity, no state file: a missing `state.enc` resolves to empty state rather than an error, and nothing asks for a private key.

```typescript
import { createContext } from '@noormdev/sdk';
import type { DB } from './schema';

export const ctx = await createContext<DB>();

await ctx.connect();
```

That is the whole runtime setup. The variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `NOORM_CONNECTION_DIALECT` | Yes | `postgres`, `mysql`, `sqlite`, or `mssql` |
| `NOORM_CONNECTION_DATABASE` | Yes | Together with `DIALECT`, this is what triggers environment-only mode |
| `NOORM_CONNECTION_HOST` | No | Defaults to `localhost` |
| `NOORM_CONNECTION_PORT` | No | Defaults per dialect: `5432` / `3306` / `1433` |
| `NOORM_CONNECTION_USER` | Usually | |
| `NOORM_CONNECTION_PASSWORD` | Usually | Read from your secret store, never from the image |
| `NOORM_CONNECTION_SSL` | No | |
| `NOORM_CONNECTION_POOL_MIN` | No | Defaults to `0` |
| `NOORM_CONNECTION_POOL_MAX` | No | Defaults to `10` |

The resulting config is named `__env__`, which is what you will see in any error message it raises.

Install the driver alongside the SDK — it is an optional peer dependency, so noorm does not pull it in for you:

```bash
npm install @noormdev/sdk kysely pg
```


## One context per process

A context owns a connection pool. Create it once when the process starts, share it across requests, and close it on shutdown:

```typescript
const ctx = await createContext<DB>();

await ctx.connect();

process.on('SIGTERM', async () => {

    await server.close();
    await ctx.disconnect();
    process.exit(0);
});
```

Calling `createContext()` per request would open a fresh pool per request, which is the classic way to exhaust a database's connection limit under load.

That limit is the number worth doing arithmetic on before you scale out. `NOORM_CONNECTION_POOL_MAX` is a **per-replica** ceiling, so your real demand is replicas × pool max. Twenty replicas at the default of 10 will try to open 200 backends — comfortably past a stock PostgreSQL's `max_connections` of 100. Either lower the per-replica pool or put PgBouncer in front:

```bash
NOORM_CONNECTION_POOL_MAX=4    # 20 replicas x 4 = 80 backends
```


## Give the runtime the access it actually needs

Your application queries tables. It does not need to build schemas or apply changes, and a config that permits those operations is a wider blast radius than the job requires. Configs carry per-channel roles, and environment-only configs default to `user: admin` — full access.

Narrow it:

```bash
NOORM_ACCESS_USER=viewer
NOORM_ACCESS_AGENT=false
```

With those set, Kysely queries work exactly as before, but the management operations refuse:

```
ProtectedConfigError: Cannot run.build on config "__env__":
"run:build" is not allowed on config "__env__" (role: viewer).
```

Set both variables or neither. The access object requires both channels, so setting only `NOORM_ACCESS_USER` fails config validation at startup rather than falling back to a default.

This is defense in depth, not a substitute for database-level permissions. Grant the runtime's database user only the privileges it needs; the noorm role stops the SDK's own management surface, not hand-written SQL.

See [Access Roles](/guide/environments/configs#access-roles) for what each role permits.


## Schema delivery runs once, elsewhere

Run `build` and `change ff` as a release step, an init container, or a Kubernetes `Job` — anywhere that runs exactly once per deploy, before the new replicas take traffic:

```yaml
- name: Apply schema
  env:
      NOORM_CONNECTION_DIALECT: postgres
      NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
      NOORM_CONNECTION_DATABASE: myapp
      NOORM_CONNECTION_USER: ${{ secrets.DB_DEPLOY_USER }}
      NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_DEPLOY_PASSWORD }}
  run: |
      noorm run build
      noorm change ff
```

noorm takes a database lock around change execution, so a second run cannot interleave with the first. It does not queue: the lock is acquired with `wait: false`, so the loser fails immediately with a lock error naming the holder. Treat that as a safety net, not a design. Fold schema delivery into application boot and the second replica to start does not wait its turn, it crashes.

If your changes render vault-backed secrets, the deploy step needs an enrolled identity too. That flow is covered in [CI/CD Automation](/guide/automation/ci#prod-ci) and applies unchanged here.


## Docker

Nothing noorm-specific goes in the image. No `.noorm/`, no identity, no config:

```dockerfile
FROM node:22-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist

CMD ["node", "dist/server.js"]
```

Configuration arrives as environment variables at run time:

```yaml
services:
    app:
        image: myapp:latest
        environment:
            NOORM_CONNECTION_DIALECT: postgres
            NOORM_CONNECTION_HOST: db
            NOORM_CONNECTION_DATABASE: myapp
            NOORM_CONNECTION_USER: app
            NOORM_CONNECTION_PASSWORD: ${DB_PASSWORD}
            NOORM_CONNECTION_POOL_MAX: 4
            NOORM_ACCESS_USER: viewer
            NOORM_ACCESS_AGENT: 'false'
```

The `sql/` and `changes/` directories only need to be present wherever schema delivery runs — the CI checkout, or a separate migration image. Your application image does not need them.


## One process, one database

Connection details come from the process environment, and `createContext()` reads that environment when it resolves. There is no `createContext({ host, user, password })` overload today, which has a consequence worth stating plainly: **in environment-only mode, a process serves one database.** (A process that does have a `state.enc` can hold several contexts at once, one per stored config, by passing `createContext({ config: 'name' })`. That route is not available here, because environment-only mode is what you get when there is no state file.)

If you are tempted to reassign `process.env` between calls to reach a second database, don't. The environment is process-global while `createContext()` is asynchronous, so two concurrent calls interleave and the later assignment wins for both:

```typescript
// Broken — both contexts connect to tenant_b.
await Promise.all([
    forTenant('tenant_a'),
    forTenant('tenant_b'),
]);
```

For multi-tenant or shard-per-customer designs, run a process per database, or hold a long-lived context per tenant created serially at startup rather than per request.

Single-database services — the overwhelming majority — are unaffected.


## What's Next?

- [CI/CD Automation](/guide/automation/ci) — pipelines, identity enrollment, vault-backed secrets
- [Configs](/guide/environments/configs) — access roles and the full environment variable table
- [SDK Reference](/reference/sdk) — the context API in full
