# v1-16 — Checksum verification for binary distribution

**Stacked branch.** Base is `v1/10-logosdx-primitives` (HEAD `3e156a1`), not master — ticket 10 rewrote `downloadToFile`'s retry loop in `src/core/update/updater.ts` (hand-rolled loop → `@logosdx/utils` `retry()`), the same file this ticket adds checksum verification to. Building on top avoids a conflict and this ticket's diff assumes ticket 10's `retry()`-based `downloadToFile` already exists. Review this diff against `3e156a1`, not against master.


## Goal

Zero checksum/signature verification exists anywhere in the distribution chain: `install.sh` (curl-pipe-sh, the marketed install path), `packages/cli/scripts/postinstall.js` (npm postinstall), and `noorm update` (`src/core/update/updater.ts`). Neither release workflow generates a checksums file. Port the pattern from the sibling `ignatius` repo (`/Users/alonso/projects/noorm/ignatius`, read-only reference — `install.sh:34-58`, `src/cli/update.ts:100-132`, `.github/workflows/release-please.yml:70-83`) but correct its one weakness: ignatius silently proceeds when `checksums.txt` is unreachable. This port hard-fails instead, with one documented, explicit escape hatch.


## Non-goals

- Binary signing / notarization / Sigstore — post-v1 per the ticket's scope boundary.
- Testing the actual binary-swap step in `installViaBinary` (renaming over `process.execPath`) — the existing test suite deliberately avoids this (`tests/core/update/updater.test.ts:8-10`: "swapping it would be catastrophic" in a test process). This ticket keeps that boundary; the checksum gate itself is fully tested in isolation, proving it throws *before* the swap is ever reached.
- Changing `downloadToFile`'s existing `chmod(destPath, 0o755)` behavior or its test (`updater.test.ts:142-156`) — that chmod lands on an inert `.download` temp file, not the live executable; harmless, out of scope.
- `scripts/install.sh` (a separate, already-dead file per `QL-xrepo-02`, superseded by root `install.sh` / `docs/public/install.sh`) — not touched; it has no live callers.
- Changing the npm-mode (`installViaNpm`) update path — npm's own registry integrity (package-lock integrity hashes) already covers that channel; this ticket is scoped to the *binary* distribution chain per the ticket title.


## Success criteria

- [ ] `src/core/update/checksum.ts` (new): `parseChecksums`, `sha256File`, `verifyChecksum`, `ChecksumError` — pure/testable checksum logic, no network-mocking gymnastics needed for the parse/hash pieces.
- [ ] `src/core/update/install-mode.ts`: `getChecksumsUrl(version)` and `getBinaryAssetName()` added, sharing the release-tag URL base with the existing `getBinaryDownloadUrl`.
- [ ] `src/core/update/updater.ts`: `installViaBinary` verifies the downloaded binary's sha256 against `checksums.txt` **before** the atomic rename that makes it the live executable (`rename(tmpPath, currentExe)`). Mismatch or unreachable-without-escape-hatch → `installUpdate` resolves `{ success: false, error: ... }`, exactly like today's download-failure path; the corrupt/unverified temp file is deleted, the running binary is never touched.
- [ ] `src/core/update/updater.ts` / `types.ts`: `installUpdate(version, options?: { insecure?: boolean })` — new optional second param, backward compatible (existing call sites in `useUpdateChecker.ts` need no change).
- [ ] `src/cli/update.ts`: `--insecure` boolean flag; also honors `NOORM_INSECURE` env var (mirrors the existing `--yes`/`NOORM_YES` pattern in `src/cli/_utils.ts`). Printed warning when running with verification bypassed.
- [ ] `install.sh`: downloads `checksums.txt` from the same release tag, verifies the downloaded binary's sha256 before `chmod +x` + `mv` into the install dir. Hard-fails (`exit 1`, temp files cleaned up) on mismatch, on `checksums.txt` being unreachable, or on no sha256 tool being present — **unless** `NOORM_INSECURE=1` is set, in which case unreachable/no-tool cases print a loud warning and proceed. A confirmed hash **mismatch always fails**, `NOORM_INSECURE` does not downgrade it (see Approach — this is a deliberate hardening beyond ignatius's leniency and beyond a literal reading of the ticket text; flagged here for visibility).
- [ ] `packages/cli/scripts/postinstall.js`: same verify-before-trust gate. Downloads the binary to a `.download` temp path, downloads `checksums.txt`, verifies, `chmod`s + renames into `bin/noorm` only on success. On a confirmed checksum mismatch or (unreachable-and-not-`NOORM_INSECURE`), exits `1` — a deliberate, scoped exception to this script's existing "never fail `npm install`" philosophy (every *other* failure mode here — unsupported platform, binary 404, etc. — still exits `0` unchanged).
- [ ] `.github/workflows/release-binary.yml` and `.github/workflows/publish.yml` (`build-binaries` job): both build `packages/cli/bin/noorm-*` via `bun run build:binary` — both gain a `shasum -a 256 noorm-* > checksums.txt` step and both upload `checksums.txt` alongside the binaries to the same release.
- [ ] New test: a tampered/corrupted binary is rejected before it would ever be trusted — local `Bun.serve` mock serving a binary + a `checksums.txt` whose recorded hash does not match the served bytes; `verifyChecksum` (or the higher-level download+verify helper) throws.
- [ ] `bun run typecheck` and `bun run lint` green.
- [ ] `shellcheck install.sh` clean (or no new warnings beyond any pre-existing baseline — record either way).
- [ ] No new try-catch introduced (repo's zero-tolerance rule); checksum-path errors follow the `attempt()` tuple convention already used throughout `updater.ts`.


## Approach

Three verification call sites share one shape: fetch `checksums.txt` from the same release tag as the binary, look up the entry for this platform's asset name, compare against a freshly computed sha256 of the downloaded bytes, and treat the *absence of a trustworthy answer* (unreachable file, missing entry, no hashing tool) differently from a *confirmed bad answer* (hash mismatch):

- **Unreachable / can't verify** → hard-fail by default (this is the ignatius weakness being fixed — ignatius's `install.sh:96-100` and `update.ts:118-131` both silently proceed here). `NOORM_INSECURE=1` / `--insecure` is the documented, opt-in escape hatch for this case only (offline installs, mirrors without `checksums.txt`, etc).
- **Confirmed mismatch** → always hard-fail, unconditionally. The escape hatch never downgrades a proven-bad hash to a warning — that would make the entire feature a no-op for the one case it exists to catch. This is a deliberate divergence from a literal reading of the ticket's "hard-fail on mismatch OR unreachable ... with an escape hatch" — read as one bypassable condition, it would let `--insecure` wave through a byte-for-byte confirmed-tampered binary, which defeats the point. Surfaced here explicitly so the human reviewer can override if they intended otherwise.

`src/core/update/checksum.ts` centralizes the shared TypeScript logic (`updater.ts` call site) as pure, independently-testable functions — mirrors ignatius's `parseChecksums`/`sha256()` split (`ignatius/src/cli/update.ts:57-65,100-104`) but returns a typed `ChecksumError` (`reason: 'unreachable' | 'mismatch'`) instead of ignatius's string-matching (`errMessage(err).includes('checksum mismatch')`) so callers branch on structure, not message text.

`install.sh` and `postinstall.js` cannot share that module (different language, and `postinstall.js` runs under Node during `npm install`, before any noorm code exists) — each reimplements the same shape natively (`shasum -a 256`/`sha256sum` dual-tool detection in the shell script per `ignatius/install.sh:42-49`; Node's built-in `crypto.createHash('sha256')` streamed over the file in postinstall.js). This is the same kind of small, deliberate duplication already flagged as low-priority in `QL-xrepo-05` (platform/arch detection reimplemented across bash/TS) — not worth a cross-language abstraction for ~15 lines each.

**Escape hatch naming.** One env var, `NOORM_INSECURE`, recognized identically by all three surfaces (`install.sh`, `postinstall.js`, `noorm update`), mirroring the existing `NOORM_YES` convention in `src/cli/_utils.ts` (truthy-string parsing: any non-empty value except `0`/`false`, case-insensitive). `noorm update` additionally accepts `--insecure` as a first-class citty flag. `install.sh`'s header comment (which already documents `NOORM_VERSION`/`NOORM_INSTALL_DIR`-style overrides) gains a line for `NOORM_INSECURE`.

**Where verification sits relative to "chmod+exec".** For `install.sh`/`postinstall.js`, chmod+move-into-place *is* the trust boundary — verification must run before it, and does. For `updater.ts`, `downloadToFile` already unconditionally `chmod`s the `.download` temp file (ticket 10's behavior, untouched, still tested by `updater.test.ts:142-156`) — that chmod is inert (the temp file is never executed from that path). The real trust boundary there is the atomic `rename(tmpPath, currentExe)` swap; verification is inserted immediately before it. Documented so the reviewer doesn't flag "verification runs after chmod" as a miss — it runs before the step that actually matters.


## Change tree

```
src/core/update/checksum.ts ............... A  (parseChecksums, sha256File, verifyChecksum, ChecksumError)
src/core/update/install-mode.ts ........... M  (getChecksumsUrl, getBinaryAssetName; shared release-base-url helper)
src/core/update/updater.ts ................ M  (installViaBinary verifies before swap; installUpdate takes options)
src/core/update/types.ts .................. M  (UpdateEvents: checksum-related events, if used)
src/cli/update.ts .......................... M  (--insecure flag, NOORM_INSECURE env fallback, warning output)
src/cli/_utils.ts .......................... M  (isInsecureMode helper, mirrors isYesMode) — only if reused; otherwise inline in update.ts
install.sh .................................. M  (download+verify checksums.txt before chmod+mv; NOORM_INSECURE)
packages/cli/scripts/postinstall.js ........ M  (download to temp, verify, chmod+rename on success only)
.github/workflows/release-binary.yml ....... M  (generate + upload checksums.txt)
.github/workflows/publish.yml .............. M  (build-binaries job: generate + upload checksums.txt)
tests/core/update/checksum.test.ts ......... A  (unit + local-server integration tests, tamper-rejection)
```


## Outline

```
src/core/update/install-mode.ts
  releaseBaseUrl(version) — private helper, factored out of getBinaryDownloadUrl:
    `https://github.com/${GITHUB_REPO}/releases/download/%40noormdev%2Fcli%40${version}`
  getBinaryAssetName() — pure, no version param: `noorm-${suffix}` using the existing
    platform/arch → suffix switch (same table as today, unchanged)
  getBinaryDownloadUrl(version) — rewritten as `${releaseBaseUrl(version)}/${getBinaryAssetName()}`
    (byte-identical output to today — existing callers/tests unaffected)
  getChecksumsUrl(version) — `${releaseBaseUrl(version)}/checksums.txt`

src/core/update/checksum.ts (new)
  parseChecksums(text: string): Record<string, string>
    — mirrors ignatius parseChecksums: line regex /^([0-9a-f]{64})\s+\*?(.+)$/i, lowercased hash,
      trailing filename as key; blank/malformed lines skipped
  sha256File(path: string): Promise<string>
    — Bun.CryptoHasher('sha256'), streamed via Bun.file(path).stream() (no full-file buffering)
  export class ChecksumError extends Error
    — readonly reason: 'unreachable' | 'mismatch'; readonly name = 'ChecksumError'
  verifyChecksum(opts: { checksumsUrl: string; assetName: string; filePath: string; insecure: boolean }): Promise<void>
    1. fetch(checksumsUrl) — non-ok or fetch-throw → unreachable path (see step 4)
    2. parse body via parseChecksums; look up opts.assetName
       — entry missing → unreachable path (same as step 4; "can't verify" either way)
    3. entry present → actual = await sha256File(opts.filePath); compare (case-insensitive)
       — mismatch → ALWAYS throw new ChecksumError('mismatch', ...) — insecure never bypasses this
       — match → resolve (verified)
    4. unreachable path (fetch failed/non-ok, OR missing entry):
       — insecure === true → emit observer event (or just return — see below), resolve without throwing
       — insecure === false → throw new ChecksumError('unreachable', ...)

src/core/update/updater.ts
  installViaBinary(version, previousVersion, insecure = false)
    — after downloadToFile succeeds (unchanged): call
      verifyChecksum({ checksumsUrl: getChecksumsUrl(version), assetName: getBinaryAssetName(),
                        filePath: tmpPath, insecure })
      wrapped in attempt() per repo convention (checksum.ts throws, this call site handles it)
    — verifyErr → delete tmpPath (attempt(() => unlink(tmpPath))), return fail(verifyErr.message)
      — same shape as the existing downloadErr branch immediately above it
    — only on verify success does the function reach the existing atomic-rename swap (unchanged)
  installUpdate(version, options: { insecure?: boolean } = {})
    — mode === 'binary' → installViaBinary(version, previousVersion, options.insecure ?? false)
    — mode !== 'binary' → installViaNpm(...) unchanged (options ignored; npm channel out of scope)

src/cli/update.ts
  args: add insecure flag { type: 'boolean', description: 'Skip checksum verification if unreachable (never bypasses a confirmed mismatch)' }
  resolve insecure = args.insecure OR the NOORM_INSECURE truthy-check, matching isYesMode's parsing
  print a one-line warning to stderr when insecure is true, before calling installUpdate
  installUpdate(checkResult.latestVersion, { insecure })

install.sh
  header comment: add NOORM_INSECURE to the documented env-var overrides list
  after existing binary download to tmpfile, before chmod:
    download checksums.txt to a second tmpfile
    if checksums.txt present:
      expected = awk lookup for the "noorm-${suffix}" entry's hash column
      if expected is empty: treat as unreachable (see below)
      else: compute actual via shasum -a 256 / sha256sum (dual-tool detection like ignatius);
        neither tool present -> treat as unreachable (see below) — this is the one place noorm's
        port improves on ignatius, which silently skips when no tool is found
        mismatch -> always: print error, delete the temp files, exit 1 (NOORM_INSECURE does not apply here)
        match -> proceed to chmod+mv (unchanged)
    else (checksums.txt unreachable):
      if NOORM_INSECURE set/truthy -> print warning, proceed to chmod+mv unverified
      else -> print error, delete the temp files, exit 1

packages/cli/scripts/postinstall.js
  download binary to a .download temp path instead of dest directly
  download checksums.txt to a buffer/string (small file — reuse the download() helper against a temp path,
    or fetch via https.get collecting body — either is fine; keep consistent with existing download() shape)
  compute sha256 of the temp file via node:crypto createHash('sha256') streamed with fs.createReadStream
  parse checksums.txt (same shasum-line format; can reuse a small local parse fn — no cross-language import)
  class ChecksumFailure extends Error (local to this file) so the top-level catch can distinguish
    "hard-fail" (mismatch, or unreachable-without-NOORM_INSECURE) from every other soft-fail path
  on success: chmodSync + rename the temp path -> dest (existing win32 chmod-skip guard unchanged)
  on ChecksumFailure in the top-level main().catch(): print error, delete the temp file, process.exit(1)
  on any OTHER error (existing behavior, unchanged): warn + process.exit(0)

.github/workflows/release-binary.yml + publish.yml (build-binaries job)
  after "Build binaries" step, add a "Generate checksums" step:
    working-directory: packages/cli/bin
    run: shasum -a 256 noorm-* > checksums.txt ; cat checksums.txt
  upload step's files: becomes multiline (matches ignatius's release-please.yml:80-82 style):
    files:
      packages/cli/bin/noorm-*
      packages/cli/bin/checksums.txt
```


## Flows

```
Flow: `noorm update` rejects a tampered binary before it ever replaces the running executable
1. checkForUpdate() reports an available version; user (or --yes) confirms
2. installUpdate(version) -> installViaBinary -> downloadToFile succeeds, tmpPath has bytes on disk
3. verifyChecksum() fetches checksums.txt, computes sha256File(tmpPath), finds it does NOT match
   the recorded entry -> throws ChecksumError('mismatch')
4. installViaBinary's attempt() catches it -> unlink(tmpPath) -> returns { success: false, error: "checksum mismatch ..." }
5. process.execPath (the live binary) was never touched -> rename(currentExe, backupPath) never ran
6. CLI prints "Update failed: checksum mismatch ..." and exits 1

Flow: `NOORM_INSECURE=1 noorm update --insecure` with checksums.txt unreachable (network blip / offline mirror)
1. downloadToFile succeeds
2. verifyChecksum's fetch(checksumsUrl) fails or returns non-ok
3. insecure === true -> resolve without throwing (loud warning already printed by the CLI before the call)
4. installViaBinary proceeds to the atomic swap as today — unverified, but the user explicitly opted in

Flow: install.sh, checksums.txt fetches fine but the downloaded binary's bytes don't match (corrupted download or tampered asset)
1. curl pulls noorm-${suffix} to the tmpfile — succeeds (no HTTP-level failure, so the existing "download failed" branch doesn't fire)
2. curl pulls checksums.txt — succeeds
3. awk finds the noorm-${suffix} entry; shasum -a 256 on the tmpfile computes a different hash
4. script prints an error, deletes both temp files, exit 1 — NOORM_INSECURE is irrelevant here (mismatch always fails)
5. the tmpfile is never chmod +x'd or moved into the install dir
```


## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Shared checksum module + URL helpers, TDD tamper-rejection test | `src/core/update/checksum.ts` (new), `src/core/update/install-mode.ts`, `tests/core/update/checksum.test.ts` (new) | atomic-implementer (mode: feature) | 3 | New test proves `verifyChecksum` throws on a mismatched local-server fixture BEFORE any implementation exists (red), then passes (green); `parseChecksums`/`sha256File` unit-covered |
| 2 | Wire into `updater.ts` + `noorm update` CLI flag | `src/core/update/updater.ts`, `src/core/update/types.ts` (if events added), `src/cli/update.ts`, `src/cli/_utils.ts` (if `isInsecureMode` extracted) | atomic-implementer (mode: feature) | 2-4 | `tests/core/update/updater.test.ts` still green in isolation (chmod test untouched); typecheck/lint green; CLI `--insecure` flag present in `--help` |
| 3 | `install.sh` + `shellcheck` | `install.sh` | atomic-implementer (mode: surgical) | 1 | `shellcheck install.sh` clean (or no new findings vs. baseline); manual read-through of the 3 flows above against the script |
| 4 | `postinstall.js` | `packages/cli/scripts/postinstall.js` | atomic-implementer (mode: surgical) | 1 | Manual read-through; `node --check packages/cli/scripts/postinstall.js` (syntax) at minimum — no live npm-install harness in this repo |
| 5 | Release workflows | `.github/workflows/release-binary.yml`, `.github/workflows/publish.yml` | atomic-implementer (mode: surgical) | 2 | YAML valid (parse check) — diff reviewed against ignatius's `release-please.yml:70-83` shape; cannot be exercised without an actual release (recorded as a manual release-day check in TESTING.md) |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `--insecure`/`NOORM_INSECURE` accidentally bypasses a confirmed mismatch, not just "unreachable" | medium (easy to write the branch backwards) | Contract locked in Outline/Approach: `verifyChecksum` throws `ChecksumError('mismatch')` unconditionally, checked *before* the `insecure` branch is ever consulted. Reviewer must verify the mismatch throw has no `insecure` guard on it. |
| Testing the real binary-swap path in `installViaBinary` (renaming over the test runner's own `process.execPath`) | high if attempted naively | Explicitly out of scope (see Non-goals) — mirrors the existing test file's own stated boundary. Coverage instead targets `verifyChecksum` directly, which is what actually prevents the swap from being reached. |
| `install.sh`/`postinstall.js` duplicate TS logic in bash/JS with subtly different edge-case handling (e.g. checksum line format assumptions) | low-medium | All three call sites tested against the identical `shasum -a 256` output format (two-space separator, optional `*` binary-mode prefix) that the release workflow step actually produces — pin this format in the spec, not just "whatever ignatius does". |
| Release-workflow change is unverifiable without cutting an actual release | certain, not really a risk to mitigate — just a known gap | Recorded explicitly in TESTING.md as a manual release-day check; workflow YAML reviewed for correctness against ignatius's proven pattern instead. |


## Change log

<!-- Populated on first amendment after the spec is approved. Do not log drafting/refinement turns. -->


## Implementation log

<!-- Filled in at finalize per /subagent-implementation Phase 3. -->
