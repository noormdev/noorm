---
type: Domain
---

# tui

## What it does

Ink/React-based terminal UI launched by `noorm ui`. Full-screen interactive interface with a home screen, keyboard-driven navigation, and per-domain screens for all noorm operations. Focus management, keyboard routing, and observer-based state updates are core TUI concerns.

## CLI code

- [`src/tui/app.tsx`](../../src/tui/app.tsx) — root component; mounts `AppContext`, `ObserverContext`, focus/keyboard providers
- [`src/tui/app-context.tsx`](../../src/tui/app-context.tsx) — `AppContext` (1196L); global state: active config, settings, lock status, update check, screen routing
- [`src/tui/screens.tsx`](../../src/tui/screens.tsx) — `ScreenRegistry`; maps screen IDs to components (664L)
- [`src/tui/screens/home.tsx`](../../src/tui/screens/home.tsx) — home screen; keyboard shortcuts for all domains (635L)
- [`src/tui/router.tsx`](../../src/tui/router.tsx) — `Router`; screen stack push/pop navigation
- [`src/tui/focus.tsx`](../../src/tui/focus.tsx) — `FocusManager`; focus stack for nested interactive components
- [`src/tui/keyboard.tsx`](../../src/tui/keyboard.tsx) — `KeyboardManager`; global key event routing with priority stacking (401L)
- [`src/tui/observer-context.ts`](../../src/tui/observer-context.ts) — `ObserverContext`; provides observer singleton to React tree
- [`src/tui/shutdown.tsx`](../../src/tui/shutdown.tsx) — graceful shutdown sequence with progress display
- [`src/tui/types.ts`](../../src/tui/types.ts) — TUI type contracts (Screen, ScreenProps, etc.) (470L)
- [`src/tui/components/`](../../src/tui/components) — shared UI components: dialogs, feedback, forms, layout, lists, overlays, secrets, status, terminal
- [`src/tui/hooks/`](../../src/tui/hooks) — 14 hooks: `useObserver`, `useConnection`, `useChangeProgress`, `useRunProgress`, `useTransferProgress`, `useLockStatus`, `useVaultConnection`, `useVaultSecretKeys`, `useSettingsOperation`, `useUpdateChecker`, `useSecretSource`, `useAsyncEffect`, `useLoadGuard`
- [`src/tui/providers/ConnectionProvider.tsx`](../../src/tui/providers/ConnectionProvider.tsx) — `ConnectionProvider`; DB connection lifecycle for TUI screens
- [`src/tui/utils/`](../../src/tui/utils) — 12 utilities: path resolution, connection helpers, config validation, clipboard, change-loader
- [`src/tui/screens/change/`](../../src/tui/screens/change) — 12 change-related screens
- [`src/tui/screens/config/`](../../src/tui/screens/config) — 11 config screens
- [`src/tui/screens/db/`](../../src/tui/screens/db) — 11 DB screens + 1 subdir
- [`src/tui/screens/debug/`](../../src/tui/screens/debug) — 4 debug screens
- [`src/tui/screens/identity/`](../../src/tui/screens/identity) — 6 identity screens
- [`src/tui/screens/init/`](../../src/tui/screens/init) — 4 init wizard screens
- [`src/tui/screens/lock/`](../../src/tui/screens/lock) — 6 lock screens
- [`src/tui/screens/run/`](../../src/tui/screens/run) — 7 run screens
- [`src/tui/screens/secret/`](../../src/tui/screens/secret) — 4 secret screens
- [`src/tui/screens/settings/`](../../src/tui/screens/settings) — 17 settings screens
- [`src/tui/screens/vault/`](../../src/tui/screens/vault) — 5 vault screens
- [`src/tui/screens/UpdateScreen.tsx`](../../src/tui/screens/UpdateScreen.tsx) — update available prompt
- [`src/tui/screens/MoreScreen.tsx`](../../src/tui/screens/MoreScreen.tsx) — extended help screen

## Docs

- [`docs/tui.md`](../tui.md) — TUI user guide (407L)
- [`docs/dev/ink-cheatsheet.md`](../dev/ink-cheatsheet.md) — Ink layout reference for developers (1427L)
- [`docs/dev/ink-testing-library-cheatsheet.md`](../dev/ink-testing-library-cheatsheet.md) — testing cheatsheet (737L)
- [`.claude/rules/tui-development.md`](../../.claude/rules/tui-development.md) — TUI development rules (focus system, UI patterns, layout)
- [`.claude/skills/noorm-design/`](../../.claude/skills/noorm-design) — design system assets and colors

## Coupling

- All TUI screens consume observer events from [`src/core/observer.ts`](../../src/core/observer.ts) — observer event shape changes break TUI hooks.
- `useConnection` and `ConnectionProvider` use [`src/core/connection/manager.ts`](../../src/core/connection/manager.ts) — connection manager resets affect TUI session.
- [`src/tui/utils/paths.ts`](../../src/tui/utils/paths.ts) uses `settings.paths.sql`/`settings.paths.changes` from SettingsManager — not per-config paths (see project CLAUDE.md).
- Lifecycle shutdown ([`src/core/lifecycle/`](../../src/core/lifecycle)) drives [`src/tui/shutdown.tsx`](../../src/tui/shutdown.tsx) — shutdown phase changes affect TUI teardown.
- TUI is launched by [`src/cli/ui.ts`](../../src/cli/ui.ts) — CLI dependency.
- `SmartConfirm`/`ProtectedConfirm` ([`src/tui/components/dialogs/`](../../src/tui/components/dialogs)) take `requiresConfirmation`/`confirmationPhrase` from a `PolicyCheck` (`checkConfigPolicy`, `core/policy`) instead of a config's `protected` flag — every destructive-action screen (change run/revert/ff, db create/destroy/teardown/truncate, config rm) calls `checkConfigPolicy` directly to build these props.
- [`src/tui/utils/config-validation.ts`](../../src/tui/utils/config-validation.ts) builds `ConfigAccess` from the Add/Edit config forms' `userRole`/`mcpRole` select fields (`buildAccessFromValues`) — `ConfigAddScreen`/`ConfigEditScreen` replaced the old single `protected` checkbox with these two role selects.
- [`src/tui/app-context.tsx`](../../src/tui/app-context.tsx) derives placeholder stage configs' `access` from `stage.defaults.protected` via `GUARDED_ACCESS`/`DEFAULT_ACCESS` (`core/policy`).

## Conventions worth knowing

- Tests use `ink-testing-library`: `render()` → `await new Promise(r => setTimeout(r, 50))` → `stdin.write()` → `lastFrame()` → `unmount()`.
- Key codes for tests: Tab=`\t`, Shift+Tab=`\x1b[Z`, Down=`\x1b[B`, Up=`\x1b[A`, Enter=`\r`, Esc=`\x1b`.
- Focus stack initialized in `useEffect` — must wait 50ms after render before sending input in tests.
- `numberNav` prop on `SelectList` enables 1-9 quick selection.
- Home screen hotkeys: `c`=config, `g`=changes, `r`=run, `d`=db, `l`=lock, `s`=settings, `k`=secrets, `i`=identity, `q`=quit.
- Sub-screen hotkeys: `a`=add, `e`=edit, `d`=delete, `x`=export, `i`=import, `u`=use/activate, `v`=validate, `k`=secrets.
- `Shift+L` toggles log viewer overlay globally.
- `guarded()` (re-exported for the TUI as `isConfigGuarded` in [`src/tui/utils/config-validation.ts`](../../src/tui/utils/config-validation.ts)) is display-only styling, never an enforcement input — `checkConfigPolicy` is the only gate.
