# Spec: v1-27 MIT license everywhere

Ticket: `tickets/v1/27-mit-license.md` · Finding: VR-hyg-01 (`research/v1-audit/v1-release/repo-hygiene.md`) · Decision: D3 RULED 2026-07-11 — MIT

The body of this spec is current truth. Superseded decisions live only in the change log.


## Objective


README advertises MIT, all three package.json declare ISC, and no LICENSE file exists. Make the license coherently MIT: real MIT text at repo root, `"license": "MIT"` in all three manifests, and the license text shipping inside both publishable npm tarballs.


## Decisions


- License: MIT (D3, ruled 2026-07-11).
- Copyright line: `Copyright (c) 2026 Danilo Alonso` — implementation default; exact attribution flagged for human confirmation before merge.
- Tarball inclusion mechanism: copy `LICENSE` into `packages/cli/` and `packages/sdk/`. npm auto-includes a `LICENSE` file present in the package directory regardless of the `files` allowlist, so no `files` array changes are needed. `npm pack --dry-run` is the proof, not the assumption.
- LICENSE text: the standard MIT license text (SPDX `MIT`), verbatim, with only the copyright line substituted. Root file and both package copies are byte-identical.

TDD: skipped because: license/config-only — no runtime behavior, nothing executable to test-drive. Verification is by inspection commands (checkpoint table below).


## Checkpoints


| # | Checkpoint | Verification command (run from worktree root) | Expected |
|---|------------|-----------------------------------------------|----------|
| CP1 | `LICENSE` exists at repo root with exact standard MIT text and copyright line `Copyright (c) 2026 Danilo Alonso` | `head -3 LICENSE` plus full-text comparison against the canonical SPDX MIT template | First line `MIT License`; copyright line exact; body matches the MIT template verbatim |
| CP2 | Root `package.json` license field is MIT | `rg -n '"license"' package.json` | Exactly one hit: `"license": "MIT"` |
| CP3 | `packages/cli/package.json` license field is MIT | `rg -n '"license"' packages/cli/package.json` | Exactly one hit: `"license": "MIT"` |
| CP4 | `packages/sdk/package.json` license field is MIT | `rg -n '"license"' packages/sdk/package.json` | Exactly one hit: `"license": "MIT"` |
| CP5 | `@noormdev/cli` tarball ships LICENSE | `cd packages/cli && npm pack --dry-run 2>&1` | File list includes `LICENSE` |
| CP6 | `@noormdev/sdk` tarball ships LICENSE | `cd packages/sdk && npm pack --dry-run 2>&1` | File list includes `LICENSE` |
| CP7 | Package LICENSE copies are byte-identical to root | `diff LICENSE packages/cli/LICENSE && diff LICENSE packages/sdk/LICENSE` | Both diffs empty (exit 0) |
| CP8 | README license section states MIT | `sed -n '/## License/,+3p' README.md` | Says `MIT` (already true pre-change; must remain true) |


## Non-goals


- No `files` array edits (npm auto-include covers LICENSE; surgical change only).
- No license headers in source files.
- No changes to example packages (`examples/*` are `"private": true`).
- No changes to `tmp/vitepress/` vendored license or any gitignored content.


## Change log


- 2026-07-12 — initial spec (inline, config-only ticket).

## Implementation log


- Status: shipped — 2026-07-12
- Iterations: 1 (implementer DONE, reviewer PASS 0🔴 0🟡 0🔵 0❓)
- Commits: `4550e99` chore: adopt MIT license across packages
- Verified: CP1-CP8 all green — reviewer independently ran every checkpoint command; `npm pack --dry-run` lists LICENSE in both `@noormdev/cli` and `@noormdev/sdk` tarballs.
- Open: copyright attribution line `Copyright (c) 2026 Danilo Alonso` used as implementation default — human to confirm exact attribution before merge.
- Out of scope, noted: `packages/sdk` pack list shows no `dist/` in this worktree (never built here); LICENSE inclusion is independent of build artifacts.
