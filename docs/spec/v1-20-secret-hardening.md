# Spec: v1-20 secret-file and passphrase hardening

Ticket: `tickets/v1/20-secret-file-hardening.md` (noorm realm). Findings: QL-sec-05, QL-sec-04, QL-sec-02, QL-sec-06 (`research/v1-audit/quality-lenses/security.md`).


## Goal

Four hardening items on secret-bearing files and passphrase input. File modes and input handling only; crypto algorithms unchanged (audited sound).

1. `config export --output` writes plaintext credentials at default 0644 — restrict to 0600.
2. `--passphrase` as a bare CLI flag leaks via ps/shell history and accepts 1-char passphrases — masked interactive prompt when flag absent + TTY, minimum length on encryption.
3. `validateKeyPermissions()` is exported dead code — wire into `loadPrivateKey()`.
4. `state.enc` writes get `{ mode: 0o600 }` (defense-in-depth; contents are sound AES-256-GCM ciphertext).


## Contract

### File modes per artifact

| Artifact | Write site | Mode | Pattern |
|----------|-----------|------|---------|
| Config export file (`--output`) | `src/cli/config/export.ts:53` | 0o600 | `writeFile(..., { encoding: 'utf8', mode: 0o600 })` then best-effort `attempt(() => chmod(path, 0o600))` — mirrors `saveKeyPair` (`src/core/identity/storage.ts:90-118`) including the chmod-after-write ("writeFile mode may not work on all platforms"; chmod also fixes pre-existing files and neutralizes umask). |
| `state.enc` (persist) | `src/core/state/manager.ts:304` | 0o600 | Add `{ mode: 0o600 }` to `writeFileSync`, then best-effort `attemptSync(() => chmodSync(this.statePath, 0o600))`. |
| `state.enc` (importEncrypted) | `src/core/state/manager.ts:752` | 0o600 | Same as persist. |

chmod failures are best-effort (swallowed via `attempt`/`attemptSync` with no throw), exactly like `saveKeyPair`. Write failures keep their existing error behavior.

### Passphrase input (`noorm db transfer`, `.dtzx`)

- **Minimum length: 12 characters**, defined once as `export const MIN_PASSPHRASE_LENGTH = 12` in `src/core/dt/crypto.ts`.
- **Enforced on encryption only.** `encryptWithPassphrase` throws `Error` (`Passphrase must be at least 12 characters`) when `passphrase.length < MIN_PASSPHRASE_LENGTH`. Plain `Error` matches the module's existing convention (no named error classes in `src/core/dt/`).
- **Not enforced on decryption.** `decryptWithPassphrase` unchanged: a floor on import would brick `.dtzx` archives encrypted by older versions with shorter passphrases; a wrong passphrase already fails via GCM auth tag verification.
- **Both input paths get the floor when exporting:**
    - Flag path: CLI validates `args.passphrase` length at the existing guard site in `src/cli/db/transfer.ts` (before any connection work) and exits 1 with an error naming the 12-char minimum.
    - Prompt path: `p.password({ ... validate })` rejects short input inline.
- **Interactive prompt** (export and import): when `.dtzx` path given, `--passphrase` absent, `process.stdin.isTTY` truthy, and `--json` not set — prompt via `@clack/prompts` `p.password()` (masked). Idiom matches the repo: `import * as p from '@clack/prompts'`, `p.isCancel(result)` then `p.cancel('Cancelled.')` + `process.exit(0)` (see `src/cli/init.ts:25-48`).
    - Export prompt `validate`: min 12 chars.
    - Import prompt `validate`: non-empty only (legacy archives).
- **CI escape hatch:** `--passphrase` flag keeps working unchanged (subject to the export floor). Non-interactive without the flag (`!isTTY` or `--json`) keeps the current behavior: `outputError` + exit 1, message updated to name the flag as the non-interactive path.
- The `--passphrase` arg description and the command `examples` note the interactive prompt; the example using a literal `mySecret` passphrase (`src/cli/db/transfer.ts:378`) is updated to a compliant illustration.

### Key-permission guard wiring

- `loadPrivateKey()` (`src/core/identity/storage.ts:229`): after a successful file read (in-memory `keyOverride` path and `ENOENT -> null` path unaffected), call `validateKeyPermissions()`; on `false`, **throw** `Error` with an actionable message: insecure permissions on `~/.noorm/identity.key`, fix with `chmod 600 <path>`. Refuse, not warn — mirrors project ruling D6 (wire in the guard).
- `validateKeyPermissions()` semantics **relaxed from strict equality to threat-model check**: passes when `(mode & 0o077) === 0` (no group/other bits — 0o600 and stricter 0o400 both pass; 0o644/0o640/0o660/0o666 fail). Strict `=== 0o600` would refuse a legitimately read-only 0o400 key.
- **Non-POSIX guard:** on `process.platform === 'win32'`, `validateKeyPermissions()` returns `true` (Windows emulates POSIX modes; stat commonly reports 0o666, which would hard-lock every Windows user out). JSDoc states this.
- Signature gains an optional path parameter defaulting to the private-key path, so the check is unit-testable against temp files (the module-scope `PRIVATE_KEY_PATH` derives from `homedir()` at import time and cannot be redirected in-process).

### Error handling convention

Producers throw plain `Error` (matching every existing throw in `storage.ts`, `manager.ts`, `crypto.ts`); `attempt()` only where the caller acts on the error; never try-catch (project ruling D1, `.claude/rules/typescript.md`).


## Checkpoints

| CP | Scope | Files (src) | Tests |
|----|-------|-------------|-------|
| CP-1 | File modes: config export + state.enc | `src/cli/config/export.ts`, `src/core/state/manager.ts` | `tests/cli/config/export.test.ts` (new, subprocess idiom per `tests/cli/config/import.test.ts`): exported file `(mode & 0o777) === 0o600`. `tests/core/state/manager.test.ts`: statePath is 0600 after persist and after `importEncrypted`. |
| CP-2 | Passphrase floor + masked prompt | `src/core/dt/crypto.ts`, `src/cli/db/transfer.ts` | `tests/core/dt/crypto.test.ts`: 1-char and 11-char passphrase throw on encrypt; 12-char succeeds; decrypt accepts short passphrase on a legacy payload. CLI test (subprocess, no DB needed — guard fires before connection): `.dtzx` export with `--passphrase x` exits 1 naming the minimum; `.dtzx` export without flag, non-TTY, exits 1 naming `--passphrase`. |
| CP-3 | Wire key-permission guard | `src/core/identity/storage.ts` | `tests/core/identity/storage.test.ts`: `validateKeyPermissions(tmpPath)` — 0600 true, 0400 true, 0644 false, 0660 false, missing false. Wiring test via subprocess (`bun -e`, `HOME=<fakeHome>`): world-readable `identity.key` -> `loadPrivateKey()` rejects; 0600 key -> resolves. |

Each checkpoint is one iteration: TDD (failing test first), then implementation, reviewer-gated, committed on PASS.


## Acceptance criteria (ticket, verbatim)

- Exported config files are 0600 (test asserts mode).
- 1-character passphrase rejected; passphrase prompt masks input.
- `validateKeyPermissions` has a production caller or no longer exists.


## Out of scope

- Crypto algorithms — unchanged; audited sound (PBKDF2-SHA256 100k, AES-256-GCM, X25519/HKDF).
- Vault storage error propagation — ticket 25.
- QL-sec-01 (DDL identifier quoting) — ticket 04.
- `node-machine-id` dead dependency (QL-sec-03) — dead-code ticket.
- TLS/in-transit posture, TUI redaction audit — not reached by the audit lens, not in this ticket.


## Testing protocol

- Implementers/orchestrator run ONLY the specific test files touched, plus `bun run typecheck` and `bun run lint`. No test groups, no `tests/integration`, no docker.
- CLI subprocess tests require `bun run build` first (they exec `dist/cli/index.js`).
- File-mode assertions are POSIX-only — CI portability note recorded in TESTING.md for the runner.


## Change log

- 2026-07-12 — initial spec from ticket 20 + audit findings (QL-sec-02/04/05/06).
- 2026-07-12 — all three checkpoints implemented and reviewer-gated PASS (203101f, cd6b4c4, a5b39ca). CP-4 (state.enc mode 0600) was folded into CP-1's scope, not a separate checkpoint -- see the File modes per artifact table. No contract deviations.
