---
'@noormdev/sdk': patch
---

Provide a CommonJS SDK runtime with an ESM facade that shares its constructors and observer. Load optional database drivers through lazy CommonJS wrappers so CommonJS test runners can connect without experimental VM modules. Publish one canonical set of ESM declarations with a CommonJS re-export facade so mixed CommonJS and ESM consumers share Context, namespace, and error types. Declarations reference Kysely's ESM types, so `ctx.kysely` type-checks with your own `kysely` imports such as `sql`; in CommonJS files compiled with `module: node16` or later (`node18`, `node20`, `nodenext`), Kysely types imported there do not match `ctx.kysely`.
