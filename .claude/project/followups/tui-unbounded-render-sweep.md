---
id: tui-unbounded-render-sweep
title: ~40 TUI screens still render unbounded content past the fold
created: "2026-09-07"
origin: |
    Full sweep of src/tui/screens/** and src/tui/components/** after the third
    user report of a screen that "doesn't scroll" (inspect, then history).
kind: finding
severity: risk
review_by: "2026-11-07"
status: open
file: src/tui/screens/change/ChangeListScreen.tsx:318 (worst of ~40)
---

Ink has no scroll offset: content taller than the terminal is unreachable, and it
pushes the screen's own footer off the bottom rather than clipping. Three screens
have been fixed one at a time as they were reported — explore, run inspect, then
the two change-history screens. This is the list of every remaining site, so the
next one is picked off a list rather than off a user's screen.

Four defect shapes, in descending severity:

- **A — fixed slice.** `.slice(0, N)` with a literal N and usually an "…and N
  more" line. The window never moves, so the rest is unreachable.
- **B — roaming cursor past a fixed window.** A `selectedIndex` clamped to
  `array.length - 1` while the render draws a fixed slice, so past row N the
  cursor selects rows that are not drawn and the detail box describes a record
  that is not on screen. Always co-occurs with A, and is the reason A is worse
  than it looks.
- **C — unbounded map.** `.map()` over state, or over `err.split('\n')`, with no
  windowing at all. Multi-line SQL errors and stack traces are the usual source.
- **D — hardcoded height.** A row budget that is a literal instead of
  `useViewportRows()`. Content stays reachable; the screen just mis-sizes.

## Ranked

1. `screens/change/ChangeListScreen.tsx:318` — C+B. The primary `noorm change`
   screen. Fully unbounded, no cap to even hit.
2. `screens/identity/KnownUsersScreen.tsx:164,190` — C+B, nested. Grows with team
   size, which is the screen's whole purpose.
3. `screens/vault/VaultScreen.tsx:447` — C. Lists every identity about to receive
   the vault master key, directly above the type-to-confirm gate it can push off
   screen.
4. `screens/db/DbTruncateScreen.tsx:276,290` — A. Preview before an irreversible
   TRUNCATE, capped at 10/5.
5. `screens/db/DbTransferScreen.tsx:1053,1091,1375,1392` — C ×4. Import preview,
   plan warnings, export summary, failures.
6. **The `split('\n').map()` family** — C, the same defect copy-pasted across
   every execution screen: `ChangeRunScreen.tsx:356,369`,
   `RunBuildScreen.tsx:481,502`, `RunDirScreen.tsx:463,763,771` (763 has no "more"
   indicator at all), `RunExecScreen.tsx:231`, `RunFileScreen.tsx:593`.
   `TextOverlay` was built for exactly this and is the direct fix.
7. `screens/db/DtModifyScreen.tsx:963,1096` — C. Column-schema dumps; 30-60
   columns is normal for a DT export.
8. `components/overlays/LogViewerOverlay.tsx:327` — C. The log-entry detail view
   has no scroll keys at all, only Escape.
9. Confirm-preview family, bounded impact — `ChangeNextScreen.tsx:310`,
   `ChangeFFScreen.tsx:255`, `ChangeRewindScreen.tsx:334,376` (334 has no
   indicator), `ChangeRevertScreen.tsx:337`.
10. Pattern D, reachable but mis-sized — `SqlHistoryScreen.tsx:74` (reads
    `terminalHeight` two lines away and still hardcodes 10),
    `ResultTable.tsx:333` (default 15, not overridden by SqlHistoryScreen),
    `SecretDefinitionList.tsx:319` (8), `SecretValueList.tsx:262` (10),
    `DbTeardownScreen.tsx:264,459` (15), `LogViewerOverlay.tsx:44` (12).

Low volume, real but bounded in practice: `home.tsx:528`,
`ConfigValidateScreen.tsx:163`, `SecretValueForm.tsx:204`,
`DtModifyScreen.tsx:1059,1547`, `SqlInput.tsx:261`.

Checked and ruled out: `DebugDetailScreen.tsx:282` (columns come from noorm's own
six fixed tracking tables, and values truncate at 77 chars), `home.tsx`'s
`recentActivity` (capped at the query), `InitScreen`'s fixed wizard steps,
`Form.tsx`'s `SELECT_VISIBLE_OPTIONS` and `RowPeekOverlay`'s `MAX_SET_ROWS` (both
deliberate centered windows).

## Reuse, do not reinvent

- `SelectList` with `renderItem` — a list with a cursor. Owns cursor, window,
  wheel, click and position memory together, which is what makes B impossible.
  Target for ChangeListScreen, KnownUsersScreen, DtModifyScreen's column tables.
- `TextOverlay` — a long message at full length. Target for every
  `split('\n').map()` above.
- `ScrollPane` + `rowWindow`/`scrollTarget` — a viewport over pre-laid-out lines
  with no cursor.
- `useViewportRows(reserveRows)` — every hardcoded Pattern-D constant.
- `oneLine(text)` — any string entering a counted single row.
