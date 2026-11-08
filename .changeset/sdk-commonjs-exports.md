---
'@noormdev/sdk': patch
---

Provide a CommonJS SDK runtime with an ESM facade that shares its constructors and observer. Load optional database drivers through lazy CommonJS wrappers so CommonJS test runners can connect without experimental VM modules. Publish one canonical set of declarations with an ESM re-export facade so mixed CommonJS and ESM consumers share Context, namespace, and error types.
