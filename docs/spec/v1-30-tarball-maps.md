# Spec: v1-30 exclude source maps from the SDK tarball

Ticket: `tickets/v1/30-sdk-tarball-maps.md`. Finding: VR-hyg-06 (`research/v1-audit/v1-release/repo-hygiene.md`). Decision: D10 RULED 2026-07-11 — exclude.


## Goal

`tsup.sdk.config.ts:20` sets `sourcemap: true`. Every published `@noormdev/sdk` tarball ships a `.map` file next to every `.js` chunk — baseline `npm pack --dry-run` in `packages/sdk` shows 38 files, 1.4MB packed / 18.2MB unpacked, with `dist/index.js.map` alone at 12.0MB unpacked (`dist/index.js` is 4.4MB). Consumers download ~2.5-3.5x more source-map bytes than actual code for a library not typically debugged inside `node_modules`.

Keep generating maps locally (dev/debugging value unchanged) — exclude them from the **published** tarball only. Do not touch `sourcemap: true` in `tsup.sdk.config.ts`.

`packages/cli` was checked for the same issue and does not have it (see Contract below) — no changes to `packages/cli`.


## Contract

### Mechanism: `files` array negation in `packages/sdk/package.json`

Change:

```json
"files": [
    "dist"
],
```

to:

```json
"files": [
    "dist",
    "!dist/**/*.map"
],
```

Verified directly (not from memory) against both packagers this repo uses:

- `npm pack --dry-run` (npm 11.6.2): baseline 38 files / 1.4MB packed / 18.2MB unpacked → with the negation, 20 files / 469.2kB packed / 5.0MB unpacked. Zero `.map` files in the listing.
- `bun pm pack --dry-run` (bun 1.3.13): same 20 files, 4.99MB unpacked, zero `.map` files. Bun's packer respects the same `!`-prefixed negation glob as npm's.

This is the minimal viable change: one new array entry, no new ignore file, no restructuring of the existing `"dist"` allowlist entry. `tsup.sdk.config.ts` is untouched — `sourcemap: true` stays, so `bun run build:packages` still writes `dist/**/*.js.map` locally; the negation only affects what `npm pack`/`bun pm pack`/`npm publish` select for the tarball.

### Why not the alternatives

- **`sourcemap: false`**: rejected by the ticket explicitly — would stop local map generation too.
- **Explicit allowlist** (`"files": ["dist/**/*.js", "dist/**/*.d.ts"]`): also works (verified conceptually — same effect, zero `.map` selected) but is a larger diff (rewrites the existing single-entry array instead of appending one line) for no behavioral difference. Negation is the less-invasive edit the ticket asks to prefer.
- **`.npmignore`**: unnecessary second ignore surface when the existing `files` allowlist already covers the same job in one line.

### `packages/cli` — confirmed not affected, no change

- `packages/cli/package.json` `"files"` is `["noorm.js", "scripts"]` — it has never included `dist/`. The published CLI tarball is a thin postinstall wrapper that downloads the compiled binary from GitHub Releases at install time (see `packages/cli/scripts/postinstall.js`); `dist/` is a `bun build --compile` binary-build artifact, not part of the npm package.
- `tsup.cli.config.ts` never sets `sourcemap` (tsup default: `false`) — confirmed by building locally: `packages/cli/dist/` contains zero `.map` files after `bun run build:packages`.
- Baseline `npm pack --dry-run` in `packages/cli`: 3 files (`noorm.js`, `package.json`, `scripts/postinstall.js`), 2.4kB packed. No `.map` anywhere, before or after this change.
- No package.json edit needed for `packages/cli`.

### Merge-touchpoint note (ticket 27, not merged)

Branch `v1/27-mit-license` (not yet merged into `master`) also edits `packages/sdk/package.json` and `packages/cli/package.json`, but only the `"license"` field (`ISC` → `MIT`) — verified via `git diff master v1/27-mit-license -- packages/sdk/package.json packages/cli/package.json`. It does not touch the `files` array in either file. No overlapping region; nothing to reconcile at merge time. Recorded here in case 27's scope changes before it merges.


## Checkpoints

| CP | Scope | Files | Verification |
|----|-------|-------|---------------|
| CP-1 | Add `"!dist/**/*.map"` to `packages/sdk/package.json` `files` array | `packages/sdk/package.json` | `bun run build:packages` (dist still contains `.js.map` files); `npm pack --dry-run` in `packages/sdk` lists zero `.map` files; `bun pm pack --dry-run` in `packages/sdk` lists zero `.map` files; `npm pack --dry-run` in `packages/cli` unchanged (still 3 files, no `dist`); `bun run typecheck` clean. |

Single checkpoint — packaging-config-only change, one file touched.


## Acceptance criteria (ticket, verbatim)

- `npm pack --dry-run` in packages/sdk lists no `.map` files; tarball size drop recorded in the PR.
- Local builds still produce maps.


## TDD

Skipped because: packaging-config only (a `package.json` `files` array entry) — no source behavior changes, nothing to unit test. Verification is the pack file-list inspection itself (see Checkpoints), which is inherently a build/pack-time check, not a runtime one.


## Out of scope

- `sourcemap: true` itself in `tsup.sdk.config.ts` — stays, per the ticket (local map generation is a separate concern from tarball contents).
- `packages/cli` — confirmed no `.map` issue exists there; no change.
- Publishing source maps to a separate symbolication service — not requested by the ticket; VR-hyg-06's prescription mentions it as an optional future idea, not part of this ticket's acceptance criteria.


## Testing protocol

- `bun run build:packages` (tsup) — produces `dist/` + `.map` files for both packages; confirms local map generation is unaffected.
- `npm pack --dry-run` in `packages/sdk` — capture file list, confirm zero `.map`, record packed/unpacked size before vs. after.
- `bun pm pack --dry-run` in `packages/sdk` — cross-check the same, since this repo uses bun as primary tooling (not pnpm — `monorepo/CLAUDE.md`'s "pnpm monorepo" line is stale/incorrect).
- `npm pack --dry-run` in `packages/cli` — confirm unaffected (still no `dist`, still 3 files).
- `bun run typecheck` — safety net; this change touches no `.ts` source.
- No test groups, no `tests/integration`, no docker — packaging-only change has no runtime surface to exercise.


## Change log

- 2026-07-12 — initial spec from ticket 30 + VR-hyg-06. Mechanism (files-array negation) pre-verified against both npm and bun packers before implementation to remove ambiguity for the implementer.


## Implementation log

### shipped — 2026-07-12

Built across 1 iteration of /subagent-implementation. Commits (chronological):

- `0fd0628a3ebbea13b28fb1c665958686ed609fe1` — CP-1 add `"!dist/**/*.map"` to packages/sdk/package.json files array

**Out-of-scope work performed during this build:**

- none

**Unforeseens — surprises that emerged during implementation:**

- none — mechanism was pre-verified against both npm and bun packers before dispatch, so implementation was a single-line change with no discovery needed.

**Deferred items still open:**

- none — reviewer returned 0🔴 0🟡 0🔵 0❓, FOLLOWUPS.md empty.
