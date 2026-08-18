---
paths:
  - "src/tui/**/*.{ts,tsx}"
  - "tests/cli/**/*.{ts,tsx}"
---

# TUI development rules


Stack: `ink@7.1.1`, `@inkjs/ui@2.0.0`, `react@19.2.4`. Rules below are correct for those versions and verified against the installed build. Where Ink 6.8.0 behaved differently the difference is noted inline, because much of this codebase was written against it.


## Focus


### Use `useFocusScope`, never Ink's focus hooks

`useFocusScope` from `src/tui/focus.tsx` is the only focus system in this codebase (83 files). Ink's `useFocus` and `useFocusManager` maintain a separate stack that ours never reads, so mixing them drops input on the floor.

```tsx
const { isFocused } = useFocusScope('my-component');

useInput((input, key) => {

    if (!isFocused) return;
    // handle input

});
```


### Check `isFocused` inside the handler, not the `isActive` option

Ink's `useInput` accepts `{ isActive }`, and passing `isFocused` to it breaks input.

`useFocusScope` pushes onto the focus stack inside a `useEffect` (`src/tui/focus.tsx:208`), so `isFocused` is `false` during the first render. Ink's `useInput` returns early from both of its effects when `isActive === false` (`use-input.js:29` and `:38`), skipping handler registration *and* `setRawMode(true)`. The handler never recovers once the effect has been skipped.

Guarding inside the handler registers it once and lets it no-op until focus arrives.

```tsx
// Correct
useInput((input, key) => {

    if (!isFocused) return;

});

// Broken: never registers, because isFocused is false on the first render
useInput(handler, { isActive: isFocused });
```

`useFocusedInput(isFocused, handler)` in `src/tui/keyboard.tsx:249` wraps this correctly. Prefer it.


### One focus owner per screen

A screen whose content is a `Form` (or any other focusable component) must not open its own scope. Two scopes on one screen means the child never reaches the top of the stack.

```tsx
// Bad: competes with Form
const { isFocused } = useFocusScope('MyScreen');
return <Form focusLabel="MyForm" ... />;

// Good: Form owns focus
return <Form focusLabel="MyForm" ... />;
```

For a screen with several states, split into components that each own their focus:

```tsx
if (!activeConfig) return <ErrorState />;   // its own useFocusScope
return <Form ... />;                         // Form's own focusLabel
```


### Reusable components take focus from the parent via `skip`

A component that is sometimes standalone and sometimes embedded accepts an optional `isFocused` prop and passes `skip` to `useFocusScope`. `skip: true` suppresses the stack push and forces `isFocused` to `false`, so the parent's value is the only one in play.

```tsx
const hasExternalFocus = externalFocused !== undefined;
const internalFocus = useFocusScope({
    label: focusLabel ?? 'SelectList',
    skip: hasExternalFocus,
});
const isFocused = hasExternalFocus ? externalFocused : internalFocus.isFocused;
```

Used by `SelectList`, `SearchableList`, `Confirm`, and `ProtectedConfirm`. Follow it for any new focusable component meant to nest.


## Keyboard


### Every `useInput` handler needs an `isFocused` guard

Ink's `useInput` is subscriber-based: every registered handler receives every keystroke regardless of focus. The guard is what makes focus mean anything.


### Backspace sets `key.backspace`, Delete sets `key.delete`

The physical Backspace key sends `0x7f`, which `parse-keypress.js:433` names `backspace`. Ctrl+H (`0x08`) does too, at `:428`. `key.delete` is the real Delete key alone. Verified against the installed build:

| Input | `key.backspace` | `key.delete` |
|-------|-----------------|--------------|
| Backspace (`0x7f`) | `true` | `false` |
| Ctrl+H (`0x08`) | `true` | `false` |
| Delete (`\x1b[3~`) | `false` | `true` |

Guard on `key.backspace` alone:

```tsx
if (key.backspace) {

    // erase one char

}
```

`ResultTable.tsx:471` does this, and `tests/cli/components/terminal.test.tsx` pins it through the filter box.

`SqlInput.tsx:172` and `LogViewerOverlay.tsx:197` still read `key.backspace || key.delete`. Ink 6.8.0 required that, because it reported `0x7f` as `delete` and left `key.backspace` true only for Ctrl+H. On 7.1.1 the extra clause only makes the Delete key erase backwards as well. Harmless where it sits, but do not copy it into new code.


### `key.meta` means Alt, not Escape

Ink 6.8.0 set `key.meta` on a plain Escape as well as on Alt combinations, so `!key.meta` doubled as an Escape filter. Ink 7 reserves it for real modifier combinations; a plain Escape now arrives with `escape: true, meta: false`. Verified against the installed build.

The two character-input filters that use it, `ResultTable.tsx:480` and `LogViewerOverlay.tsx:208`, both sit behind a `key.escape` early return in the same handler (`:452` and `:165`), and Ink strips the escape byte so `input` is empty anyway. They kept working. Do not rely on `!key.meta` to exclude Escape. Test `key.escape` and return.


### A parent must not consume arrow keys its child owns

When the focused child handles its own arrow navigation, the parent has to opt out or it intercepts first. Deciding that per *field type* is the trap: `Form` used to skip arrow handling whenever the active field was a select, so the only way out of a select was Tab, and a user pressing Down got option-cycling instead of the next field.

Split it by *mode* instead, and let the child mount only in the mode it owns. `Form.tsx:606` is the reference:

```tsx
if (isEditing) {

    // Everything else belongs to the field: TextInput's own handler for
    // text/password, SelectField's for select.
    if (key.escape) {

        revertEdit();

        return;

    }

    if (key.return) {

        commitEdit();

    }

    return;

}

if (key.downArrow) {

    moveBy(1);

    return;

}
```

`SelectField` is rendered only while its field is in edit mode, so its `useInput` is not even registered in browse mode. Ownership is decided by what exists, not by a type check the parent has to keep in sync.


### Global keys

`GlobalKeyboard` (`src/tui/keyboard.tsx:114`) owns Ctrl+C, Shift+L, Shift+Q, `?`, `D`, and `F`. It deliberately does **not** handle Esc: each screen handles its own, because a global handler fires alongside the screen handler and pops history twice.

`?`, `D`, and `F` only fire when `stack.length <= 1`, so they stay inert while a text input is focused.


## @inkjs/ui components


| Component | Use it? | Reason |
|-----------|---------|--------|
| `TextInput` | No — use ours | `src/tui/components/forms/TextInput.tsx` is upstream's, plus the mouse-report guard. Still display-only when `isDisabled`, so the focus stack stays authoritative |
| `Spinner`, `Badge`, `ProgressBar`, `Alert`, `StatusMessage` | Yes | Display-only, no input handling |
| `Select`, `MultiSelect`, `ConfirmInput` | No | Drive Ink's internal focus, which our stack never sees |

Build interactive replacements from `useFocusScope` + `useInput`. `SelectList` (`src/tui/components/lists/SelectList.tsx`) and `Confirm` (`src/tui/components/dialogs/Confirm.tsx`) already exist for the two common cases.

`forms/TextInput.tsx` is pinned to upstream *differentially*, not by hand: `tests/cli/components/text-input.test.tsx` drives the same keystroke script through both and compares the `onChange`/`onSubmit` logs, and a child process at `FORCE_COLOR=1` compares the rendered frames byte for byte. If `@inkjs/ui` is upgraded, that file is what tells you whether the copy still matches.


## Terminal size comes from `useWindowSize`

`useWindowSize()` returns `{ columns, rows }` as plain numbers and re-renders the component on resize, so anything derived from it is current by construction.

```tsx
const { rows: terminalHeight } = useWindowSize();

const maxRows = useMemo(() => Math.floor((terminalHeight - 9) * 0.75), [terminalHeight]);
```

Never size a component from `useStdout().stdout.rows`. Ink's resize handler (`ink.js:279`) calls `calculateLayout()` and `onRender()`, which re-lay-out and re-paint the *existing* React output without a state update, so the component never re-executes. A probe against the installed build confirms it: emitting `resize` left a `useStdout` component's execution count at 1 while a `useWindowSize` component went from 1 to 2.

Consequences for any component that reads `stdout.rows`:

- A value read during render is frozen at mount and only refreshes when something *else* re-renders the component.
- A `useMemo` keyed on `[stdout.rows]` never recomputes on resize, because the dependency is only compared when the component re-executes.

Reserve `useStdout()` for `write()`.

Two screens size themselves this way. Copy either:

| Location | Shape |
|----------|-------|
| `src/tui/screens/db/SqlTerminalScreen.tsx:51,55-63` | `useMemo(..., [terminalHeight])` sizing the result table |
| `src/tui/screens/config/ConfigEditScreen.tsx:49,268` | `formHeight` derived in the render body |

In a screen with early returns, the hook has to sit above them, or the hook count changes between renders once the async load resolves. `ConfigEditScreen` is the worked example and `tests/cli/screens/config/ConfigEditScreen.test.tsx:132` guards it.

Write no `?? 24` fallback. `useWindowSize` already falls back to the `terminal-size` probe and then to 80x24 when the stream reports nothing.


## Observer hooks

Use the hooks in `src/tui/hooks/useObserver.ts` for event subscriptions. They handle unsubscribe on unmount.

```tsx
import { useOnEvent, useOnceEvent, useEmit, useOnScreenPopped } from '../hooks/index.js';

useOnEvent('changeset:complete', (data) => {

    setResults((prev) => [...prev, data]);

}, []);

useOnceEvent('build:complete', (data) => setFinalResult(data), []);

const emitStart = useEmit('build:start');
emitStart({ schemaPath, fileCount });

// Reset local state when a screen is popped off the router stack
useOnScreenPopped('db/explore', () => clearExploreFilters());
```


## Feedback patterns

Report success and failure with a toast plus `back()`, not a dead-end confirmation screen. `back()` pops history, so the breadcrumb gains no duplicate entry.

```tsx
const { showToast } = useToast();
const { back } = useRouter();

showToast({ message: 'Config saved', variant: 'success' });
back();
```

Keep failures on the form with `busy` and `statusError` so the user can correct the input in place.

```tsx
<Form
    busy={isLoading}
    busyLabel="Testing connection..."
    statusError={connectionError}
/>
```


## Testing

TUI tests live in `tests/cli/**` and use `bun:test` with `ink-testing-library`.

Wrap anything focusable in `FocusProvider`, wait after render before writing to stdin, and call `unmount()` to release stdin handlers. The wait is required because the focus stack initializes in a `useEffect`, so input sent on the same tick lands before any handler is registered.

```tsx
const { stdin, lastFrame, unmount } = render(<FocusProvider><MyComponent /></FocusProvider>);

await new Promise((r) => setTimeout(r, 50));
stdin.write('\x1B[B');
await new Promise((r) => setTimeout(r, 50));

unmount();
```

| Key | Sequence |
|-----|----------|
| Up | `\x1B[A` |
| Down | `\x1B[B` |
| Enter | `\r` |
| Escape | `\x1B` |
| Backspace | `\x7F` |
| Delete | `\x1B[3~` |

A multi-character `stdin.write('abc')` arrives as one `input` string, not three events.

Ink 7 writes a cleared frame as it unmounts, so a render-time throw shows up in `frames` but never in `lastFrame()`. Assert against `frames.join('')` when testing an error path. `tests/cli/focus.test.tsx:116` is the reference.


### Fixed sleeps are the suite's weak point

A fixed `setTimeout` says "probably long enough", and a number of TUI tests bet on one. Under machine load that bet loses. Measured on the CI CLI group, same machine, same commit: two `ink@7.1.1` runs took 169.4s and 155.0s and each failed a *different* small set of tests (`cli: router > navigate`, then `cli: DismissableAlert`); both failures inspected were the wait expiring before the frame arrived, not a behavior change. A third `ink@7.1.1` run on an idle machine took 111.9s and passed clean, and two `ink@6.8.0` runs took 109.0s and 109.8s and also passed clean.

Read that carefully: the failures track wall-clock pressure, not the Ink version. Do not file these as an Ink 7 regression. The fragile thing is the fixed sleep.

Prefer polling until the condition holds over sleeping a guessed duration:

```tsx
const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((r) => setTimeout(r, 10));

    }

};

await waitFor(() => Boolean(lastFrame()?.includes('route:config')));
```

The existing fixed-sleep tests have not been converted. Convert one when you touch it.


## Keyboard shortcuts

Hotkey registry. Verify against the screen source before changing any of it.

**Home** (`src/tui/screens/home.tsx:248`):

| Key | Action |
|-----|--------|
| `r` | run |
| `c` | config |
| `g` | changes |
| `d` | db |
| `+` | more (settings, vault, identity, lock) |
| `s` | settings |
| `v` | vault |
| `i` | identity |
| `l` | lock |
| `u` | update |
| `1` / `2` / `3` | quick actions: run build, change ff, lock status |
| `q` | quit |

There is no `k` on Home. Secrets belong to a config, so `k` opens them from the config list.

**Common actions (sub-screens):**

| Key | Action | Note |
|-----|--------|------|
| `a` | add | |
| `e` | edit | |
| `d` | delete | |
| `k` | secrets | **k**eys, from the config list |
| `+` | more | export / import / validate live here, not on the list |
| `Enter` | use/activate | selecting a config activates it |

**Context-dependent keys:**

| Key | Screen | Action |
|-----|--------|--------|
| `i` | Home | identity |
| `i` | config More | import |
| `x` | config More | export |
| `x` | Identity | export |
| `x` | Lock Status | extend |
| `x` | DB list | explore |
| `s` | Home | settings |
| `s` | Lock List | status |
| `c` | Home | config |
| `c` | config list | copy |
| `c` | DB list | create |

**Global (every screen, via `GlobalKeyboard`):**

| Key | Action |
|-----|--------|
| `Ctrl+C` | graceful exit |
| `Shift+L` | toggle log viewer overlay |
| `Shift+Q` | open the SQL terminal |
| `?` | show help |
| `D` | toggle dry-run mode |
| `F` | toggle force mode |

Pass `numberNav` to `SelectList` for 1-9 quick selection in lists.


## Mouse

There is no mouse support in Ink 7.1.1 — no hook, no parsing. `src/tui/mouse.tsx` is the whole transport: it writes the tracking escape sequences, parses SGR reports off `useInput`, restores the terminal on every exit path, and hit-tests rows with `measureElement`.

It is **on** unless `ui.mouse` is false in `.noorm/settings.yml`. Off means inert: no escape sequence, no `useInput` registration, no `process` listener, no refs on rows. What an absent flag means is decided once, by `isMouseEnabled` in `src/core/settings/defaults.ts`; never read `settings?.ui?.mouse` directly.

- **Never write `?1000h` / `?1006h` anywhere else.** A second writer means a second thing that has to disable on exit, and a terminal left in mouse mode outlives the process — click-drag selection stays broken in every shell in that window.
- **Answer clicks with `useRowMouse`**, not by parsing in a component. It takes the same `isActive` guard the keyboard handler uses, because a click acts on whatever already has focus.
- **A handler with a catch-all character branch needs `isMouseReport(input)`.** Reports reach every `useInput` as a plain string, so `ResultTable`'s filter box and `SqlInput` would otherwise type `[<0;12;5M` into themselves. A handler that only tests named keys and exact characters needs no guard — `SelectList` has none, and the mutation harness is why.
- **Use `TextInput` from `src/tui/components/forms/`, never from `@inkjs/ui`.** Upstream's handler ends in an unconditional `state.insert(input)`, so a click while a field is in edit mode types the report into the field — and where that field feeds a derived value, such as `ChangeAddScreen`'s change-folder name, the report reaches disk. `forms/TextInput.tsx` is upstream's component with that one guard added; the exports map publishes only the package root, so wrapping it was not possible and copying it was.

`measureElement`'s `x`/`y` are live-region coordinates and SGR's are 1-based terminal coordinates; the conversion is one constant in `mouse.tsx`. It holds because the TUI renders in the alternate screen with no `<Static>` in the tree, so the frame starts at the home position. Add a `<Static>` and that constant stops being a constant.


## Ink 7 APIs still unused

`alternateScreen` is in use (`src/cli/ui.ts:54`) and so is `measureElement` (`src/tui/mouse.tsx`). What is left:

| API | What it covers |
|-----|----------------|
| `usePaste` | Bracketed paste delivered as a single string. `SqlInput` currently submits only the first line of a multi-line paste. |
| `useBoxMetrics` | Measured box width/height/left/top, instead of the hand-counted chrome constants at `SqlTerminalScreen.tsx:57` and `ConfigEditScreen.tsx:268`. |
| `useAnimation`, `suspendTerminal()`, `interactive` | No current need. |

`<Text>` no longer accepts `wrap="end"` or `wrap="middle"`. Both were undocumented no-ops on 6.8.0 and were dropped from the type in 7.0.0. This codebase uses only `wrap="wrap"` and `wrap="truncate"`, so nothing changed.

`useFocusManager` gained `activeId` in Ink 7. It reports Ink's own focus registry, which `useFocusScope` never writes to, so it does not tell you what this codebase considers focused. The focus rules above stand unchanged.
