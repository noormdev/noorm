---
"@noormdev/sdk": minor
---

### Added
* `feat(sdk):` Add `ctx.tvf()` method for calling table-valued functions on MSSQL and PostgreSQL
* `feat(sdk):` Add `Tvfs` generic parameter to `createContext()`, `Context`, and `ImpersonatedScope` for type-safe TVF signatures

### Changed
* `refactor(sdk):` Replace `as any` casts in impersonation scope with proper generic flow through `buildProcCall<T>`, `buildFuncCall<T>`, and `buildTvfCall<T>`
