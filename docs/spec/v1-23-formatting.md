# Spec: display/formatting consolidation

Ticket: `tickets/v1/23-formatting-consolidation.md` · Decision: `tickets/v1/00-DECISIONS.md` D7 (keep voca, adopt it)

The body of this spec is current truth. Superseded decisions live only in the change log.


## Objective

Six hand-rolled string/format helpers duplicate either each other or an already-installed dependency (voca, `@logosdx/utils`, dayjs, native `Date`). Per D7, voca stays a dependency and gets adopted at its duplication sites rather than removed. Consolidate to one implementation per concern; delete the hand-rolled copies. Output must be byte-identical to today's behavior everywhere it's cheap to prove — the two places where the replacement library's output genuinely differs from the hand-rolled original are called out explicitly below rather than silently shipped.

Formatting/string helpers only. No behavior change beyond consolidation.


## Checkpoints

### CP-1 — Shared `formatAccessTag`

`src/cli/config/list.ts:48` and `src/tui/screens/config/ConfigListScreen.tsx:49-57` each implement `` `user:${access.user} mcp:${access.mcp === false ? 'off' : access.mcp}` ``, gated by `guarded()`.

- Add `formatAccessTag(config: { name: string; access: ConfigAccess }): string | null` to `src/core/policy/check.ts`, next to `guarded()` (same display-only category, same file both call sites already import from). Export it from `src/core/policy/index.ts`.
- `cli/config/list.ts` and `ConfigListScreen.tsx` both call the shared function; delete the local `ConfigListScreen.tsx` `formatAccessTag` and the inline template literal in `list.ts`.
- Output identical by construction — same expression, one location.
- Existing test `tests/cli/config/list.test.ts` (3 cases: guarded, `mcp:off`, admin/admin omitted) is the byte-identical proof for the CLI side; it drives the compiled binary (`dist/cli/index.js`), so this checkpoint requires a build before that test can run. Add an equivalent unit test for `formatAccessTag` itself in `tests/core/policy/check.test.ts` (guarded / mcp-off / admin-admin-returns-null) so the function is covered independent of the CLI subprocess test.

### CP-2 — `formatByteSize` replaces local `formatBytes`

`src/tui/screens/db/SqlClearScreen.tsx:37-44` hand-rolls B/KB/MB thresholds with `.toFixed(1)`.

- Replace with `formatByteSize` from `@logosdx/utils` (already a dependency, 173+ import sites elsewhere in the repo for other utilities). Delete the local `formatBytes` function.
- **Documented output diff** (no test currently locks the old format, so this is a deliberate, called-out change, not a silent one): the hand-rolled version produced `"512 B"`, `"1.5 KB"`, `"2.3 MB"` (space-separated, uppercase unit, 1 decimal, caps at MB). `formatByteSize` produces `"512b"`, `"1.5kb"`, `"2.3mb"` (no space, lowercase unit, auto-extends to gb/tb) — call it with `{ decimals: 1 }` to preserve the prior precision; casing and spacing are the library's fixed format and are not worth wrapping to hide. This is a cosmetic-only change on a stats display (SQL history clear screen) — no assertions depend on the old format.
- Add a smoke test if one is cheap (e.g. a unit test asserting `formatByteSize` is imported and used — or skip if the screen has no existing test harness; do not build one from scratch solely for this checkpoint beyond a trivial import/usage check).

### CP-3 — Three hand-rolled `truncate()` → voca `v.truncate`

Three divergent implementations:

| Site | Ellipsis | Formula |
|---|---|---|
| `src/tui/screens/db/SqlHistoryScreen.tsx:51-59` (`truncateSql`) | `'...'` | `slice(0, maxLen - 3) + '...'` |
| `src/tui/screens/debug/DebugListScreen.tsx:525-531` (`truncate`) | `'...'` | `slice(0, maxLen - 3) + '...'` |
| `src/tui/components/terminal/ResultTable.tsx:247-253` (`truncate`) | `'…'` (single-char ellipsis) | `slice(0, maxLen - 1) + '…'` |

- Replace all three with direct `v.truncate(str, maxLen)` (SqlHistoryScreen, DebugListScreen — voca's default `end` is `'...'`, matching exactly) and `v.truncate(str, maxLen, '…')` (ResultTable — voca's third arg overrides the ellipsis string). Delete all three local functions; import `v from 'voca'` in each file.
- **Verified byte-identical** (not called out as a diff — confirmed via direct comparison, not assumed): voca's `truncate(subject, length, end)` returns `subject` unchanged when `length >= subject.length`, otherwise `subject.substr(0, length - end.length) + end` — algebraically identical to both hand-rolled formulas for their respective ellipsis strings. Spot-checked with representative inputs (`"Once upon a time"` at len 10 → `"Once up..."` both ways; custom ellipsis at len 12 → matches `ResultTable`'s `…` behavior).
- `truncateSql` keeps its whitespace-collapse step (`sql.replace(/\s+/g, ' ').trim()`) before calling `v.truncate` — that preprocessing is unrelated to truncation and stays.

### CP-4 — `camelCase` → voca

`src/core/template/utils.ts:27-42` hand-rolls `camelCase()`, used only by `toContextKey()`. The file's docblock claims "String transformation utilities using Voca" — currently false.

- Replace the local `camelCase` with `v.camelCase(base)` (import `v from 'voca'`). Delete the local function.
- **Verified byte-identical** against every case in `tests/core/template/utils.test.ts` (`toContextKey`: kebab-case, snake_case, SCREAMING_CASE, simple filenames, multiple extensions, mixed case) — all six existing test cases produce identical output under `v.camelCase`. Existing tests are the regression proof; no new test needed for this checkpoint beyond keeping them green.
- Docblock becomes literally true once this lands — no wording change needed, the claim just stops being false.
- **Documented output diff for embedded-dot basenames** (found in review, not caught by the six existing test cases): voca's `camelCase` splits on embedded dots in addition to `-`/`_`/case-boundaries; the hand-rolled version did not. A side-car data-file basename containing a literal dot after extension-stripping (e.g. `'user.roles.json5'` → base `'user.roles'`) previously produced `'user.roles'` (dot preserved — an unusable bare property-access key); `v.camelCase('user.roles')` produces `'userRoles'`. No existing test/fixture uses a dotted multi-word basename, so this isn't a regression against current coverage, and it's arguably an improvement (the old output was unusable as a template context key) — but it's a real divergence, called out here rather than left silent.

### CP-5 — `slugify` → voca

`src/core/change/scaffold.ts:582-590` hand-rolls `slugify()`, used by `createChange`, `addFile`, `renameFile`.

- Replace with `v.slugify(text)` (import `v from 'voca'` — not currently imported in this file). Delete the local function.
- **Verified byte-identical for ASCII input** (every existing test case: `'add-email-verification'`, `'Fix Login Bug!'`, `'  Multiple   Spaces  '`, `'create_tokens_table'`, `'Add User Roles 2.0'`, `'---leading-trailing---'`) — voca's `slugify` (latinise + kebab-case) and the hand-rolled version (lowercase + strip non-`[a-z0-9]` to `-` + trim) produce identical output for all of these.
- **Documented output diff for non-ASCII input**: voca's `slugify` transliterates diacritics (`'café münchën'` → `'cafe-munchen'`) where the hand-rolled version collapsed them to hyphens (`'café münchën'` → `'caf-m-nch-n'`). This is a behavior improvement, not a regression, and no test in `tests/core/change/scaffold.test.ts` exercises non-ASCII descriptions — call it out here rather than adding scope to preserve the worse behavior.

### CP-6 — `formatDate` → dayjs

`src/core/change/scaffold.ts:566-577` hand-rolls `YYYY-MM-DD` via `getFullYear()`/`getMonth()`/`getDate()` + manual zero-padding.

- Replace with `dayjs(date).format('YYYY-MM-DD')`. Delete the local `formatDate` function. `dayjs` is already imported project-wide; add the import to `scaffold.ts`.
- **Verified byte-identical**: dayjs's `YYYY-MM-DD` format uses the same local-time field extraction as the hand-rolled version (`getFullYear`/`getMonth`/`getDate`), confirmed via direct comparison. `tests/core/change/scaffold.test.ts` asserts on the resulting change-directory name (`'2025-06-15-custom-date-test'`) — this is the regression proof.

### CP-7 — dayjs removed from logger hot path

`src/core/logger/logger.ts:26,517,530,589` calls `dayjs().format(...)` on every log line for two **fixed, non-locale, non-timezone-conversion** formats:

- `'YY-MM-DD HH:mm:ss'` (console, `#writeConsole`, two call sites: color mode line 517, plain mode line 530)
- `'YYYY-MM-DDTHH:mm:ss.SSSZ'` (JSON entry, `#buildJsonEntry` line 589) — dayjs's `Z` token is the **local UTC offset as `±HH:mm`** (verified: `+00:00` for UTC, not a literal `"Z"`), not the ISO "Zulu" suffix — the native replacement must reproduce the offset, not `Date.toISOString()`'s behavior.

Add a small local formatter (~10 lines) in `src/core/logger/` (new file, e.g. `timestamp.ts`, or inline in `logger.ts` if that reads cleaner — implementer's call) using native `Date` getters:

```
formatLogTimestamp(d: Date): string        // 'YY-MM-DD HH:mm:ss'
formatLogTimestampIso(d: Date): string      // 'YYYY-MM-DDTHH:mm:ss.SSS±HH:mm'
```

- 2-digit year = `String(d.getFullYear()).slice(-2)`.
- UTC offset sign/magnitude: `d.getTimezoneOffset()` is UTC-minus-local in minutes (positive when local is behind UTC). Sign is `'+'` when offset `<= 0`, else `'-'`; magnitude is `Math.abs(offset)` split into hours/minutes, zero-padded.
- Drop the `dayjs` import from `logger.ts`; replace both call sites (3 total: :517, :530, :589) with the native formatter.
- **dayjs stays a project dependency** — do not touch `package.json`. `src/tui/utils/date.ts` (`relativeTimeAgo`, using the `relativeTime` plugin) and `src/tui/screens/db/SqlHistoryScreen.tsx` (`dayjs(...).fromNow()`) keep using dayjs; that usage is out of scope and legitimate (native `Intl.RelativeTimeFormat` would require hand-rolled unit-bucketing to match — not worth it here).
- Regression proof: existing `tests/core/logger/output.test.ts` regex-asserts the shape (`/\[\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/` for console, `/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/` for JSON `time`), not exact values — these must stay green. Add one direct unit test for `formatLogTimestamp`/`formatLogTimestampIso` against a fixed `Date` to lock the exact format (not just the regex shape) — e.g. construct a `Date` from known UTC millis and assert both the date/time portion and the offset math.


## Out of scope

- No behavior change beyond what's documented above as an explicit diff (CP-2 byte format, CP-5 non-ASCII slugify).
- No new abstraction beyond what's needed — voca/dayjs/`@logosdx/utils` are called directly at each site; no wrapper module invented to "normalize" their output back to the old shape.
- `dayjs` is not removed as a dependency (D7/AP-std-04 note: TUI relative-time usage is legitimate and stays).
- `voca` is not removed as a dependency (D7 supersedes AP-std-01's drop recommendation).


## Acceptance criteria (verbatim from ticket)

- One implementation each; hand-rolled string helpers deleted; visible output byte-identical (snapshot or fixture comparison where cheap — voca truncation must match current ellipsis behavior or the diff is called out).


## Verification

- `bun run typecheck`
- `bun run lint`
- Targeted tests: `tests/core/policy/check.test.ts`, `tests/core/template/utils.test.ts`, `tests/core/change/scaffold.test.ts`, `tests/core/logger/output.test.ts`, `tests/core/logger/logger.test.ts`, `tests/cli/config/list.test.ts` (requires `bun run build` first — this test drives `dist/cli/index.js`).
- No integration/docker tests required — this ticket touches display/formatting only, no DB-facing code.
