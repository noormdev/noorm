# Spec: v1-28 Headless config parity — honest exit codes + `config rm --yes`

Ticket: `tickets/v1/28-headless-config-parity.md` (realm repo). Decision D4 RULED 2026-07-11 — full prescription accepted. Branch: `v1/28-headless-config-parity` off `next` @ `bce82df`. Reviewers diff against `bce82df`. **v1-blocker.**

## Goal

`config add` / `config edit` / `config rm` (`src/cli/config/{add,edit,rm}.ts`) print `Interactive only — run: noorm ui` and **exit 0** — false success that silently lies to scripts, and there is no non-interactive way to delete a config.

1. **Honest stubs**: `config add` and `config edit` keep pointing to the TUI but exit **1**, message on **stderr** — matching the established pattern of every other TTY-gated command (survey `src/cli/**` for the existing convention and reuse its helper if one exists; do not invent a parallel one).
2. **Real headless `config rm <name> --yes`**: deletion needs no wizard. Behavior:
   - `noorm config rm <name> --yes` deletes the named config headlessly.
   - Without `--yes` (or truthy `NOORM_YES` via ticket 02's unified machinery — see how other destructive commands consume it in `src/cli/_utils.ts`) it refuses with exit 1 and a message telling the user to pass `--yes` or use the TUI.
   - Unknown config name → clear error, exit 1.
   - Deletion routes through the **same core path the TUI uses** — find the config-deletion function the TUI screen calls and reuse it, so ticket 29's locked-stage guard applies. `ConfigLockedStageError` / the `{ok, reason}` refusal from `src/core/config/resolver.ts` (~line 419-472) must surface as a clear message + exit 1, never be bypassed.
   - Output/JSON shape follows whatever convention comparable destructive headless commands adopted in ticket 06's `--json` sweep — match, don't invent.

## Non-goals

- Headless `config add`/`edit` wizards — out of scope by D4; they remain TUI-only (just with honest exit codes).
- Changing TUI deletion flow.
- New confirmation machinery — reuse ticket 02's.

## Checkpoints

| # | Checkpoint | Files | Agent | Verifies |
|---|---|---|---|---|
| 1 | Honest exit-1 stubs | `src/cli/config/add.ts`, `src/cli/config/edit.ts` | atomic-implementer (mode: surgical) | Non-TTY and TTY invocations exit 1, message on stderr matching the repo's TTY-gated pattern; tests assert exit code + stream (extend existing `tests/cli/config/**` or create). |
| 2 | Headless `config rm` | `src/cli/config/rm.ts` (+ help/examples) | atomic-implementer (mode: feature) | All four paths tested: with `--yes` deletes (state actually mutated); without `--yes` refuses exit 1; unknown name exit 1; locked-stage-linked config refuses exit 1 with the guard's reason. Routes through the TUI's core deletion path — reviewer must verify no guard bypass. `examples` block updated. |
| 3 | Docs | headless/CI docs under `docs/` that enumerate non-interactive commands | atomic-implementer (mode: surgical) | `config rm --yes` documented; add/edit documented as interactive-only with exit 1. Locate via grep for existing `config` mentions in docs; update only what exists — no new doc pages. |

## Acceptance criteria (from ticket)

- `noorm config add` in a non-TTY context exits 1 with a clear message; same for `edit`.
- `noorm config rm <name> --yes` deletes headlessly; without `--yes` it refuses non-interactively with exit 1.
- Help text and headless docs updated; test per path.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| CLI tests can't easily assert `process.exit` codes | medium | Follow the existing pattern in `tests/cli/**` for exit-code assertions (other exit-1 commands are already tested — find and mirror). |
| Deletion path needs decrypted state (identity/passphrase) not available headlessly | medium | The state manager already operates headlessly for other commands (`config use`, `list`); reuse their bootstrap. If a genuine blocker appears, record in STATE.md and stop — do not hand-roll state decryption. |
| Guard bypass via calling storage directly | low | Spec mandates the TUI's core path; reviewer checkpoint explicitly checks for bypass. |

## Change log

- 2026-07-12 — initial spec, authored by orchestrator pre-implementation.
