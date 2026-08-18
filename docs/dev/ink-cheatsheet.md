# Ink Cheatsheet


A reference for building CLI applications with Ink (React for the terminal).

This page documents the upstream Ink API, not noorm's own TUI. Where the two diverge, noorm's rules win—see `.claude/rules/tui-development.md`. The divergences are called out inline below. Installed here: `ink@^7.1.1`, `react@^19.2.4`, `@inkjs/ui@^2.0.0`.

The body describes Ink 7.1.1 (released 2026-07-16), which is the installed version. Everything here is available to you. Two markers record *when* a thing arrived, which is what you need when reading noorm code written against Ink 6:

| Marker | Meaning |
|--------|---------|
| **[Ink 7]** | Arrived in Ink 7.x. Ink 6.8.0 had no such export. |
| **[Changed in 7]** | Existed in Ink 6.8.0 as well, but behaved differently there. See [Migrating from Ink 6 to Ink 7](#migrating-from-ink-6-to-ink-7). |

Find every one of them with `rg '\[Ink 7\]|\[Changed in 7\]' docs/dev/ink-cheatsheet.md`.

noorm went from 6.8.0 to 7.1.1 with no peer bumps. Ink 7 requires Node >=22 and React >=19.2; `engines.node >= 22.13` and `react@^19.2.4` already met both. [Migrating from Ink 6 to Ink 7](#migrating-from-ink-6-to-ink-7) walks each breaking change and what it cost here.


## Table of Contents


- [Installation](#installation)
- [What Ink 7 Changes for noorm](#what-ink-7-changes-for-noorm)
- [Migrating from Ink 6 to Ink 7](#migrating-from-ink-6-to-ink-7)
- [Core Concepts](#core-concepts)
- [Components](#components)
- [Hooks](#hooks)
- [Ink UI Components](#ink-ui-components)
- [Meow (Argument Parsing)](#meow-argument-parsing)
- [Patterns](#patterns)
- [Tips & Gotchas](#tips--gotchas)


## Installation


Already installed in this repo—`bun install` is enough. For a new project:

```bash
bun add ink react
bun add -d @types/react @types/node typescript
```

For Ink UI components:

```bash
bun add @inkjs/ui
```

This repo is Bun-managed (`bun.lockb`, `bunfig.toml`, `engines.bun >= 1.2`). Running `npm install` here creates a conflicting lockfile.


## What Ink 7 Changes for noorm


The upgrade closed two live bugs. Three more Ink 7 capabilities cover things this codebase still hand-rolls or lives without.

Fixed by the upgrade:

| noorm bug | What fixed it | Where |
|-----------|---------------|-------|
| Terminal resize never re-rendered | `useStdout` replaced by [`useWindowSize`](#usewindowsize) | `src/tui/screens/db/SqlTerminalScreen.tsx:51,55-63`<br>`src/tui/screens/config/ConfigEditScreen.tsx:49,262` |
| Filter-mode Backspace did nothing | The version bump alone; the existing guard became correct | `src/tui/components/terminal/ResultTable.tsx:471` |

Still open:

| noorm problem | Where it lives today | Ink 7 answer |
|---------------|----------------------|--------------|
| Multi-line paste submits a partial query | `src/tui/components/terminal/SqlInput.tsx:78,139-157` | [`usePaste`](#usepaste) |
| Exiting the TUI leaves its frames in scrollback | `src/cli/ui.ts:45`<br>`src/cli/sql/repl.ts:108` | [`alternateScreen`](#render-options) |
| Chrome heights are hand-counted constants | `src/tui/screens/db/SqlTerminalScreen.tsx:57`<br>`src/tui/screens/config/ConfigEditScreen.tsx:262` | [`useBoxMetrics`](#useboxmetrics), [`measureElement`](#measureelement) |


### Resize is reactive now

Both screens used to read the stream from `useStdout()` and size themselves from `stdout.rows`:

```tsx
const { stdout } = useStdout();

const maxResultRows = useMemo(() => {

    const terminalHeight = stdout.rows ?? 24;
    // ... arithmetic

}, [stdout.rows]);
```

Node updates `stdout.rows` when the terminal resizes, but nothing asks React to re-render. A dependency array is compared only during a render pass, so with no render there is no comparison, and `maxResultRows` held its stale value until some unrelated state change happened to re-render the screen. `ConfigEditScreen` had the same defect in a different shape: it read `stdout.rows` in the render body, which does pick up a new value on any render, but a resize by itself still produced no render.

`useWindowSize()` subscribes to the resize event and re-renders the component, so the value is current by construction. `src/tui/screens/db/SqlTerminalScreen.tsx:51,55-63`:

```tsx
const { rows: terminalHeight } = useWindowSize();     // [Ink 7]

const maxResultRows = useMemo(() => {

    const uiChrome = 9;
    const availableHeight = terminalHeight - uiChrome;
    const maxRows = Math.floor(availableHeight * 0.75);

    return Math.max(5, Math.min(maxRows, 30));

}, [terminalHeight]);
```

`src/tui/screens/config/ConfigEditScreen.tsx:49,262` does the same for `formHeight`. Its hook has to stay above the screen's early returns, because those returns run before the config finishes loading and a hook called after them changes the hook count between renders.

The `?? 24` fallback both sites carried is gone: `useWindowSize` returns `columns` and `rows` as plain numbers, falling back to the `terminal-size` probe and then to 80x24 when the stream reports nothing.


### Pasted SQL submits before it is complete

Nothing in `src/` enables bracketed paste, and `src/tui/components/terminal/SqlInput.tsx:78` reads keys through `useInput`. Without bracketed paste the terminal gives Ink no way to distinguish pasted text from typed text, so a newline inside a paste is indistinguishable from pressing Enter. `SqlInput.tsx:139-157` routes Enter like this:

```tsx
if (key.return) {

    if (key.shift || editMode) { /* insert a newline */ }
    else if (value.trim()) { onSubmit(value); }

    return;

}
```

Outside edit mode, the first newline in a pasted multi-line statement calls `onSubmit(value)` with only the first line.

`usePaste` turns bracketed paste mode on while the hook is mounted and delivers the paste as one string. Ink routes paste and keypresses on separate channels, so pasted content never reaches the `useInput` handler while `usePaste` is active:

```tsx
usePaste((text) => {                  // [Ink 7]

    const before = value.slice(0, cursor);
    const after = value.slice(cursor);

    updateValue(before + text + after, cursor + text.length);

});
```


### The TUI has no alternate screen

Both entry points render onto the primary screen: `src/cli/ui.ts:45` and `src/cli/sql/repl.ts:108`, each with `{ exitOnCtrlC: false, patchConsole: true }`. On `app:exit` they call `clear()` then `unmount()`, which erases the last frame but leaves earlier output in the user's scrollback.

`alternateScreen: true` renders into the terminal's alternate buffer, the mechanism vim and less use, and restores the previous terminal contents on exit.

```tsx
render(<App />, {
    exitOnCtrlC: false,
    patchConsole: true,
    alternateScreen: true,            // [Ink 7]
});
```

::: warning Two constraints before adopting it
Scrollback is unavailable while the alternate screen is active, which is standard terminal behavior but changes how the log viewer overlay feels. Ink also treats alternate-screen teardown output as disposable: frames, hook writes, and `console.*` output produced after unmount begins are not replayed onto the restored screen. Anything the user must still see after exit has to be written after the Ink instance is gone.
:::


### Chrome heights are hand-counted

Neither `measureElement` nor `useBoxMetrics` is used anywhere in `src/`. Both height budgets are maintained by hand and drift whenever the chrome changes:

- `SqlTerminalScreen.tsx:57` — `const uiChrome = 9;`, with a comment enumerating header (2), panel border (2), status bar (1), separator (1), footer (2), help (1).
- `ConfigEditScreen.tsx:262` — `Math.max(terminalHeight - 6, 10)`, reserving panel border (2), title (2), padding (2).

`useBoxMetrics(ref)` reports a real box's measured `width`, `height`, `left`, and `top`, and re-reports on layout change, so the number comes from the rendered tree instead of a comment. Ink 7.1.1's `measureElement` also returns `x` and `y` now, not just `width` and `height`.


### Filter-mode Backspace works now

`src/tui/components/terminal/ResultTable.tsx:471` checks only `key.backspace`:

```tsx
if (key.backspace) {

    setFilter((f) => ({ ...f, term: f.term.slice(0, -1) }));

    return;

}
```

Most terminals send byte `0x7F` for the Backspace key. Ink 6.8.0 reported that as `key.delete`, so this branch never fired and the filter term could not be edited. Ink 7 reports it as `key.backspace`, so the bump alone made the existing code correct — no edit to this file. `tests/cli/components/terminal.test.tsx` pins the behavior: it fails on 6.8.0 and passes on 7.1.1.

The other two Backspace handlers, `SqlInput.tsx:172` and `LogViewerOverlay.tsx:197`, check `key.backspace || key.delete`. That was required on 6.8.0 and is now merely harmless: it makes the real Delete key erase backwards too. New code should test `key.backspace` alone.


## Migrating from Ink 6 to Ink 7


Ink 7.0.0 has four breaking changes. All four cost noorm nothing; this is the record of why.

| Change | Outcome here |
|--------|--------------|
| Requires Node >=22 | Already met — `engines.node >= 22.13` |
| Requires React >=19.2 (Ink uses `useEffectEvent` internally) | Already met — `react@^19.2.4`, `@types/react@^19.2.14` |
| Backspace sets `key.backspace`, not `key.delete` | One site fixed itself (`ResultTable.tsx:471`), two were already safe |
| `key.meta` is no longer `true` on plain Escape | No effect — see below |


### `key.backspace` vs `key.delete`

Most terminals send the same byte for Backspace as for Delete, and Ink 6 misreported it. Ink 7 separates them.

```tsx
// Before (Ink 6) — the physical Backspace key arrived as key.delete
useInput((input, key) => {
    if (key.delete) { /* fired for physical Backspace */ }
});

// After (Ink 7)
useInput((input, key) => {
    if (key.backspace) { /* physical Backspace (0x7F) */ }
    if (key.delete)    { /* the real Delete key, e.g. Fn+Backspace */ }
});
```

`SqlInput.tsx:172` and `LogViewerOverlay.tsx:197` check both flags, which is why they survived the upgrade untouched. Now that 7.1.1 is the installed version, new code should test `key.backspace` for Backspace and leave `key.delete` to the Delete key.


### `key.meta` on plain Escape

Ink 6 set `key.meta` to `true` for a plain Escape as well as for Alt/Meta combinations. Ink 7 reserves `key.meta` for actual modifier combinations.

```tsx
// Before (Ink 6) — key.meta was true for Escape AND for Alt+key
useInput((input, key) => {
    if (key.meta) { /* also fired on plain Escape */ }
});

// After (Ink 7) — test key.escape for Escape
useInput((input, key) => {
    if (key.escape) { /* plain Escape */ }
    if (key.meta)   { /* Alt/Meta combinations only */ }
});
```

noorm has two `!key.meta` guards on character input, `ResultTable.tsx:480` and `LogViewerOverlay.tsx:208`, both testing `input && !key.ctrl && !key.meta`. Neither depends on the old behavior: Ink strips the leading escape byte before it reaches the handler, so a plain Escape arrives with `input` empty and the `input &&` test already rejects it. The `!key.meta` clause keeps doing its intended job of filtering Alt combinations.


### One change the release notes omit

Ink 6.8.0's `textWrap` type accepted two values the 6.8.0 readme never documented: `wrap="end"` and `wrap="middle"`. Neither did anything. Ink 6's `wrapText` matches only the `wrap` branch and values starting with `truncate`, so both fell through and returned the text unmodified. Running 6.8.0's `wrapText('hello world', 5, mode)` gives `"hello world"` for `end` and `middle`, against `"hell…"` for `truncate-end`.

Ink 7.0.0 removed both from the type. The release notes do not mention it.

If you find one in a codebase, deleting the prop preserves what the screen renders today. Rewriting it to `truncate-end` or `truncate-middle` does not: it replaces a no-op with real truncation. noorm has neither, using only `wrap="wrap"` and `wrap="truncate"`.


### Fixes carried by the 7.0.x and 7.1.x line

Upgrading picks these up along with the new API.

| Version | Fix | Bearing on noorm |
|---------|-----|------------------|
| 7.0.0 | Wide characters (emoji, CJK) no longer split on overlapping writes; CJK text no longer truncates past `<Box>` width | Result grids render arbitrary column data, so this is the highest-value fix here |
| 7.0.0 | `useInput` no longer crashes on unmapped key codes | Every screen registers a `useInput` handler |
| 7.0.0 | Incremental rendering handles a trailing newline | Only with `incrementalRendering: true`, which noorm does not set |
| 7.0.1 | `disableFocus()` is respected when handling Escape; `useApp` exit typing restored | Ink's own focus registry, which noorm does not use |
| 7.0.2 | Raw-mode disable is deferred, preventing a process hang on component swap | Both entry points unmount and then `process.exit(0)` |
| 7.0.0, 7.0.3, 7.1.1 | Four `<Static>` correctness fixes | None. `<Static>` is unused in `src/` |
| 7.0.3 | `useBoxMetrics` accepts refs whose initial value is `null` | Applies to the standard `useRef(null)` form |
| 7.0.4 | One shared resize listener via `emitLayoutListeners` instead of one per hook | Matters once `useWindowSize` is used on several screens |
| 7.0.5 | Incomplete stack frames handled in the error overview | Error display only |
| 7.0.6 | Stale frames on Windows when output exactly fills the terminal | Windows only |


## Core Concepts


### Basic App Structure

```tsx
#!/usr/bin/env node
import { render } from "ink";
import { App } from "./App.js";

render(<App />, {
    exitOnCtrlC: true,
});
```


### render() Options

```tsx
const instance = render(<App />, {
    stdout: process.stdout,      // Output stream
    stdin: process.stdin,        // Input stream
    stderr: process.stderr,      // Error stream
    exitOnCtrlC: true,           // Exit on Ctrl+C
    patchConsole: true,          // Patch console.log to work with Ink
    debug: false,                // Debug mode
});

// Instance methods
instance.unmount();              // Unmount the app
instance.clear();                // Clear the output
instance.rerender(<NewApp />);   // Re-render with new component
await instance.waitUntilExit();  // Wait for app to exit
```

The second argument may also be a plain `WriteStream` instead of an options object.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `stdout` | `WriteStream` | `process.stdout` | Output stream |
| `stdin` | `ReadStream` | `process.stdin` | Input stream |
| `stderr` | `WriteStream` | `process.stderr` | Error stream |
| `exitOnCtrlC` | `boolean` | `true` | Listen for Ctrl+C and exit |
| `patchConsole` | `boolean` | `true` | Keep `console.*` output from mixing into Ink's |
| `debug` | `boolean` | `false` | Write each update as separate output instead of replacing |
| `maxFps` | `number` | `30` | Ceiling on render updates per second |
| `incrementalRendering` | `boolean` | `false` | Redraw only changed lines |
| `concurrent` | `boolean` | `false` | React concurrent mode: Suspense, `useTransition`, `useDeferredValue` |
| `onRender` | `(metrics) => void` | — | Runs after each committed frame with `{ renderTime }` |
| `isScreenReaderEnabled` | `boolean` | `INK_SCREEN_READER === 'true'` | Screen reader support |
| `kittyKeyboard` | `KittyKeyboardOptions` | — | Kitty protocol config: `{ mode, flags }` |
| `interactive` | `boolean` | auto | **[Ink 7]** Override interactive-mode detection |
| `alternateScreen` | `boolean` | `false` | **[Ink 7]** Render into the terminal's alternate screen buffer |

`interactive` defaults to `true`, or `false` when running in CI or when `stdout.isTTY` is falsy. Non-interactive mode disables ANSI erase sequences, cursor manipulation, synchronized output, resize handling, and Kitty auto-detection, writing only the final frame at unmount. `alternateScreen` is ignored whenever the session is non-interactive.

Reusing one `stdout` across several `render()` calls without unmounting is unsupported. Call `unmount()` first, or use `cleanup()`.


#### Instance Methods

| Method | Description |
|--------|-------------|
| `rerender(node)` | Replace the root node or update its props |
| `unmount()` | Unmount the app |
| `clear()` | Clear the output |
| `waitUntilExit()` | Promise settling when the app unmounts; resolves with the value passed to `exit(value)`, rejects with the error passed to `exit(error)` |
| `waitUntilRenderFlush()` | **[Ink 7]** Promise settling once pending output is flushed to stdout |
| `cleanup()` | **[Changed in 7]** Drop the internal instance for this stdout so the next `render()` builds a fresh one. Ink 7 also unmounts the current app first, leaving no terminal state such as the alternate screen behind; 6.8.0 only removes the registry entry and never unmounts |


### Exit Programmatically

```tsx
import { useApp } from "ink";

function App() {
    const { exit } = useApp();

    // Exit normally
    exit();

    // Exit with error (rejects waitUntilExit promise)
    exit(new Error("Something went wrong"));
}
```


## Components


### Box

The fundamental layout component. Works like a `<div>` with flexbox.

```tsx
import { Box, Text } from "ink";

// Basic usage
<Box margin={2}>
    <Text>Content</Text>
</Box>

// Flexbox layout
<Box flexDirection="column" justifyContent="center" alignItems="center">
    <Text>Centered</Text>
</Box>

// With dimensions
<Box width={50} height={10} padding={1}>
    <Text>Fixed size</Text>
</Box>

// Percentage width
<Box width="50%">
    <Text>Half width</Text>
</Box>
```


#### Box Props Reference

Layout props only. `borderStyle`, `borderColor`, the individual `borderTop`/`borderBottom`/`borderLeft`/`borderRight` booleans, and `backgroundColor` are covered in the two sections that follow.

| Prop | Type | Description |
|------|------|-------------|
| `flexDirection` | `row` \| `column` \| `row-reverse` \| `column-reverse` | Direction of flex items |
| `flexGrow` | `number` | Grow factor |
| `flexShrink` | `number` | Shrink factor |
| `flexBasis` | `number` \| `string` | Initial size before free space is distributed |
| `flexWrap` | `wrap` \| `nowrap` \| `wrap-reverse` | Wrap behavior |
| `justifyContent` | `flex-start` \| `flex-end` \| `center` \| `space-between` \| `space-around` \| `space-evenly` | Main axis alignment |
| `alignItems` | `flex-start` \| `flex-end` \| `center` \| `stretch` \| `baseline` | Cross axis alignment. `baseline` is **[Ink 7]** |
| `alignSelf` | `flex-start` \| `flex-end` \| `center` \| `auto` \| `stretch` \| `baseline` | Self alignment. `stretch` and `baseline` are **[Ink 7]** |
| `alignContent` | `flex-start` \| `flex-end` \| `center` \| `stretch` \| `space-between` \| `space-around` \| `space-evenly` | **[Ink 7]** Cross axis alignment across wrapped lines |
| `gap` | `number` | Gap between children |
| `rowGap` | `number` | Gap between rows |
| `columnGap` | `number` | Gap between columns |
| `width` | `number` \| `string` | Width (number or percentage) |
| `height` | `number` \| `string` | Height (number or percentage) |
| `minWidth` | `number` \| `string` | Minimum width. Percentages unsupported |
| `minHeight` | `number` \| `string` | Minimum height (rows or percentage) |
| `maxWidth` | `number` \| `string` | **[Ink 7]** Maximum width. Percentages unsupported |
| `maxHeight` | `number` \| `string` | **[Ink 7]** Maximum height (rows or percentage) |
| `aspectRatio` | `number` | **[Ink 7]** Width/height ratio. Needs at least one size constraint so Ink can derive the other dimension |
| `position` | `relative` \| `absolute` \| `static` | Positioning mode, default `relative`. `static` is **[Ink 7]** and ignores the offsets below |
| `top` / `right` / `bottom` / `left` | `number` \| `string` | **[Ink 7]** Offsets for positioned elements |
| `display` | `flex` \| `none` | `none` hides the element |
| `overflow` | `visible` \| `hidden` | Overflow in both directions, default `visible` |
| `overflowX` / `overflowY` | `visible` \| `hidden` | Overflow per axis |
| `padding` | `number` | Padding all sides |
| `paddingX` | `number` | Horizontal padding |
| `paddingY` | `number` | Vertical padding |
| `paddingTop` | `number` | Top padding |
| `paddingBottom` | `number` | Bottom padding |
| `paddingLeft` | `number` | Left padding |
| `paddingRight` | `number` | Right padding |
| `margin` | `number` | Margin all sides |
| `marginX` | `number` | Horizontal margin |
| `marginY` | `number` | Vertical margin |
| `marginTop` | `number` | Top margin |
| `marginBottom` | `number` | Bottom margin |
| `marginLeft` | `number` | Left margin |
| `marginRight` | `number` | Right margin |


#### Border Styles

```tsx
// Predefined styles
<Box borderStyle="single">Single</Box>
<Box borderStyle="double">Double</Box>
<Box borderStyle="round">Round</Box>
<Box borderStyle="bold">Bold</Box>
<Box borderStyle="singleDouble">Single Double</Box>
<Box borderStyle="doubleSingle">Double Single</Box>
<Box borderStyle="classic">Classic</Box>

// Border color
<Box borderStyle="round" borderColor="cyan">
    <Text>Colored border</Text>
</Box>

// Individual borders
<Box borderTop borderBottom borderLeft={false} borderRight={false}>
    <Text>Top and bottom only</Text>
</Box>

// Custom border
<Box borderStyle={{
    topLeft: "╔",
    top: "═",
    topRight: "╗",
    left: "║",
    right: "║",
    bottomLeft: "╚",
    bottom: "═",
    bottomRight: "╝"
}}>
    <Text>Custom</Text>
</Box>

// Border background, independent of the box background
<Box borderStyle="round" borderColor="white" borderBackgroundColor="blue">
    <Text>Border painted on blue</Text>
</Box>
```


#### Border Props Reference

| Prop | Type | Description |
|------|------|-------------|
| `borderStyle` | `keyof Boxes` \| `BoxStyle` | Named style or a custom character set. No border when unset |
| `borderTop` / `borderBottom` / `borderLeft` / `borderRight` | `boolean` | Per-side visibility, each defaulting to `true` |
| `borderColor` | `string` | Shorthand for all four per-side colors |
| `borderTopColor` / `borderBottomColor` / `borderLeftColor` / `borderRightColor` | `string` | Per-side color |
| `borderDimColor` | `boolean` | Shorthand for all four per-side dim flags, default `false` |
| `borderTopDimColor` / `borderBottomDimColor` / `borderLeftDimColor` / `borderRightDimColor` | `boolean` | Per-side dim |
| `borderBackgroundColor` | `string` | **[Ink 7]** Shorthand for all four per-side border backgrounds |
| `borderTopBackgroundColor` / `borderBottomBackgroundColor` / `borderLeftBackgroundColor` / `borderRightBackgroundColor` | `string` | **[Ink 7]** Per-side border background |


#### Background Colors

```tsx
<Box backgroundColor="red">Red background</Box>
<Box backgroundColor="#FF8800">Hex color</Box>
<Box backgroundColor="rgb(0, 255, 0)">RGB color</Box>
```


### Text

All text must be wrapped in `<Text>` components.

```tsx
import { Text } from "ink";

// Colors
<Text color="green">Green text</Text>
<Text color="#FF5733">Hex color</Text>
<Text color="rgb(255, 87, 51)">RGB color</Text>

// Background
<Text backgroundColor="blue" color="white">White on blue</Text>

// Styles
<Text bold>Bold</Text>
<Text italic>Italic</Text>
<Text underline>Underlined</Text>
<Text strikethrough>Strikethrough</Text>
<Text dimColor>Dimmed</Text>
<Text inverse>Inverted</Text>

// Combine styles
<Text bold italic color="cyan">Bold italic cyan</Text>

// Text wrapping
<Text wrap="truncate">Long text will be truncated...</Text>
<Text wrap="truncate-start">Truncates at the start...</Text>
<Text wrap="truncate-middle">Truncates in the middle...</Text>
<Text wrap="truncate-end">Truncates at the end...</Text>

// [Ink 7] Fill every line to the full column width, breaking words as needed
<Text wrap="hard">Long text broken mid-word to fill each line...</Text>
```


#### Text Props Reference

| Prop | Type | Description |
|------|------|-------------|
| `color` | `string` | Text color (name, hex, rgb) |
| `backgroundColor` | `string` | Background color |
| `bold` | `boolean` | Bold text |
| `italic` | `boolean` | Italic text |
| `underline` | `boolean` | Underlined text |
| `strikethrough` | `boolean` | Strikethrough text |
| `dimColor` | `boolean` | Dimmed color |
| `inverse` | `boolean` | Inverse colors |
| `wrap` | `wrap` \| `hard` \| `truncate` \| `truncate-start` \| `truncate-middle` \| `truncate-end` | Wrap behavior, default `wrap`. `hard` is **[Ink 7]** |

::: warning Two dead wrap values were removed in Ink 7
Ink 6.8.0's type accepted `wrap="end"` and `wrap="middle"`, both undocumented and both no-ops that returned the text unchanged. Ink 7.0.0 dropped them from the type. Delete the prop to keep current rendering; swapping in `truncate-end` or `truncate-middle` starts truncating text that was never truncated before. See [One change the release notes omit](#one-change-the-release-notes-omit). noorm uses neither.
:::


### Newline

Insert a newline.

```tsx
import { Newline, Text } from "ink";

<Text>
    First line
    <Newline />
    Second line
</Text>

// Multiple newlines
<Text>
    Line 1
    <Newline count={2} />
    Line 4
</Text>
```


### Spacer

Fills available space (like `flex-grow: 1`).

```tsx
import { Box, Text, Spacer } from "ink";

// Horizontal spacing
<Box>
    <Text>Left</Text>
    <Spacer />
    <Text>Right</Text>
</Box>

// Vertical spacing
<Box flexDirection="column" height={10}>
    <Text>Top</Text>
    <Spacer />
    <Text>Bottom</Text>
</Box>
```


### Static

Renders content permanently (won't be updated). Perfect for logs or completed tasks.

```tsx
import { Static, Box, Text } from "ink";

function App() {
    const [logs, setLogs] = useState<string[]>([]);

    return (
        <>
            {/* Rendered once, never updated */}
            <Static items={logs}>
                {(log, index) => (
                    <Box key={index}>
                        <Text color="green">✓ {log}</Text>
                    </Box>
                )}
            </Static>

            {/* Dynamic content below */}
            <Box>
                <Text>Processing...</Text>
            </Box>
        </>
    );
}
```


### Transform

Transform text output with a function.

```tsx
import { Transform, Text } from "ink";

<Transform transform={(output) => output.toUpperCase()}>
    <Text>This will be uppercase</Text>
</Transform>
```


## Hooks


### useInput

Handle keyboard input.

```tsx
import { useInput } from "ink";

function App() {
    useInput((input, key) => {
        // Character input
        if (input === "q") {
            process.exit(0);
        }

        // Special keys
        if (key.return) {
            // Enter pressed
        }

        if (key.escape) {
            // Escape pressed
        }

        // Arrow keys
        if (key.upArrow) { }
        if (key.downArrow) { }
        if (key.leftArrow) { }
        if (key.rightArrow) { }

        // Modifiers
        if (key.ctrl && input === "c") {
            // Ctrl+C
        }

        if (key.meta) {
            // [Changed in 7] Alt/Option combinations only.
            // Ink 6 also set this to true on a plain Escape.
        }

        if (key.shift) {
            // Shift key held
        }

        // Other special keys
        if (key.backspace) { } // [Changed in 7] the physical Backspace key (0x7F)
        if (key.delete) { }    // [Changed in 7] the real Delete key, e.g. Fn+Backspace
        if (key.tab) { }
        if (key.pageUp) { }
        if (key.pageDown) { }
        if (key.home) { }
        if (key.end) { }
    });
}
```

::: warning Backspace and Escape changed in Ink 7
On Ink 6.8.0 the Backspace key sets `key.delete`, and a plain Escape sets both `key.escape` and `key.meta`. Both are fixed in Ink 7. Checking `key.backspace || key.delete` works on either version. See [Migrating from Ink 6 to Ink 7](#migrating-from-ink-6-to-ink-7).
:::


#### Key Object Reference

| Property | Type | Description |
|----------|------|-------------|
| `upArrow` | `boolean` | Up arrow pressed |
| `downArrow` | `boolean` | Down arrow pressed |
| `leftArrow` | `boolean` | Left arrow pressed |
| `rightArrow` | `boolean` | Right arrow pressed |
| `return` | `boolean` | Enter/Return pressed |
| `escape` | `boolean` | Escape pressed |
| `ctrl` | `boolean` | Ctrl held |
| `shift` | `boolean` | Shift held |
| `meta` | `boolean` | Alt/Option held. **[Changed in 7]** no longer `true` on a plain Escape |
| `tab` | `boolean` | Tab pressed |
| `backspace` | `boolean` | Backspace pressed. **[Changed in 7]** Ink 6 reported this key as `delete` |
| `delete` | `boolean` | Delete pressed. **[Changed in 7]** now the real Delete key only |
| `pageUp` | `boolean` | Page Up pressed |
| `pageDown` | `boolean` | Page Down pressed |
| `home` | `boolean` | Home pressed |
| `end` | `boolean` | End pressed |
| `super` | `boolean` | Cmd/Win held. Kitty protocol only |
| `hyper` | `boolean` | Hyper held. Kitty protocol only |
| `capsLock` | `boolean` | Caps Lock active. Kitty protocol only |
| `numLock` | `boolean` | Num Lock active. Kitty protocol only |
| `eventType` | `'press' \| 'repeat' \| 'release'` | Key event type. Kitty protocol only |

::: tip Kitty protocol detection widened in Ink 7
**[Changed in 7]** In `auto` mode Ink now queries every terminal for Kitty keyboard protocol support instead of consulting a hardcoded allowlist, so the `super`, `hyper`, `capsLock`, `numLock`, and `eventType` fields populate in more terminals than they did on 6.8.0. Configure it with the `kittyKeyboard` render option.
:::


#### Conditional Input

```tsx
// Only listen when active
useInput(
    (input, key) => { /* ... */ },
    { isActive: isFocused }
);
```

::: danger noorm guards inside the handler instead
The "Focus System" section of `.claude/rules/tui-development.md` requires the opposite of the upstream pattern above. In `src/tui/`, check `isFocused` inside the handler body, not through the `isActive` option:

```tsx
const { isFocused } = useFocusScope('my-component');

useInput((input, key) => {

    if (!isFocused) return;
    // handle input

});
```

`isActive: false` prevents the handler from registering at all, and `isFocused` is false on the first render because noorm's focus stack initializes in a `useEffect`. Registering unconditionally and returning early is what keeps the component reachable. Ink 7 does not change this; the divergence stands.
:::


### useFocus

::: danger Not used in noorm
`useFocus` and `useFocusManager` drive Ink's *internal* focus registry, which does not communicate with noorm's. Mixing the two loses keyboard input. In `src/tui/`, use `useFocusScope` from `src/tui/focus.tsx`, inside a `FocusProvider`. The rest of this section is upstream reference only.
:::

Make components focusable (Tab/Shift+Tab navigation).

```tsx
import { useFocus, Text } from "ink";

function FocusableItem() {
    const { isFocused } = useFocus();

    return (
        <Text color={isFocused ? "green" : "white"}>
            {isFocused ? "> " : "  "}Item
        </Text>
    );
}

// With options
function AutoFocusItem() {
    const { isFocused } = useFocus({
        autoFocus: true,  // Focus on mount
        id: "my-item",    // Unique ID for programmatic focus
    });

    return <Text>{isFocused ? "Focused" : "Not focused"}</Text>;
}
```


### useFocusManager

Programmatically control focus.

```tsx
import { useFocusManager, useInput } from "ink";

function App() {
    const {
        focusNext,      // Focus next item
        focusPrevious,  // Focus previous item
        focus,          // Focus specific ID
        enableFocus,    // Enable focus system
        disableFocus,   // Disable focus system
        activeId,       // [Ink 7] ID of the focused component, or undefined
    } = useFocusManager();

    useInput((input, key) => {
        if (key.downArrow) focusNext();
        if (key.upArrow) focusPrevious();
        if (input === "1") focus("item-1");
    });

    return (/* ... */);
}
```


### useApp

Access app instance methods.

```tsx
import { useApp } from "ink";

function App() {
    const { exit } = useApp();

    // Exit the application
    const handleDone = () => exit();

    // Exit with error
    const handleError = () => exit(new Error("Failed"));
}
```

`exit(value)` resolves `waitUntilExit()` with `value`; `exit(error)` rejects it.

Ink 7 adds two more members to the same object.

```tsx
const { exit, waitUntilRenderFlush, suspendTerminal } = useApp();

// [Ink 7] Wait for the pending frame to reach stdout
await waitUntilRenderFlush();
```


#### suspendTerminal

**[Ink 7]** Added in 7.1.0. Hands the terminal to a child process such as `$EDITOR`, `less`, or `fzf`, then restores Ink's terminal state and forces a full redraw. The callback form restores the terminal even when the callback throws.

```tsx
const { suspendTerminal } = useApp();

// Callback form - preferred
await suspendTerminal(async () => {
    await runEditor();
});

// Handle form - resume yourself, or let `await using` do it on scope exit
await using suspension = await suspendTerminal();
await runEditor();
```

Called without a callback it returns a `TerminalSuspension`: `{ resume(), [Symbol.asyncDispose]() }`.


### useStdin

Access stdin stream.

```tsx
import { useStdin } from "ink";

function App() {
    const {
        stdin,           // stdin stream
        isRawModeSupported,  // Can use raw mode?
        setRawMode,      // Enable/disable raw mode
    } = useStdin();
}
```


### useStdout

Access stdout stream and dimensions.

```tsx
import { useStdout } from "ink";

function App() {
    const { stdout, write } = useStdout();

    // Terminal dimensions
    const { columns, rows } = stdout;

    // Write directly to stdout
    write("Direct output\n");
}
```

::: danger `stdout.rows` does not trigger re-renders
Node mutates `stdout.rows` and `stdout.columns` when the terminal resizes, but that mutation asks React for nothing. A component sized from `stdout.rows` keeps its old layout until an unrelated state change re-renders it, and a `[stdout.rows]` dependency array is never even compared in the meantime.

Use [`useWindowSize`](#usewindowsize) **[Ink 7]** for dimensions. Reserve `useStdout` for `write()`. The two noorm screens that had this bug were converted on the 7.1.1 upgrade: see [Resize is reactive now](#resize-is-reactive-now).
:::


### useStderr

Access stderr stream.

```tsx
import { useStderr } from "ink";

function App() {
    const { stderr, write } = useStderr();

    write("Error message\n");
}
```


### usePaste

**[Ink 7]** Handle clipboard pastes as a single string.

```tsx
import { useInput, usePaste } from "ink";

function Editor() {
    useInput((input, key) => {
        // Typed characters and key events only, never pasted text
        if (key.return) { /* submit */ }
    });

    usePaste((text) => {
        // The whole pasted string, newlines included
        insert(text);
    });
}

// Disable when another component should own pastes
usePaste(handler, { isActive: isFocused });
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `handler` | `(text: string) => void` | Called once per paste with the full string |
| `options.isActive` | `boolean` | Enable or disable the handler, default `true` |

While the hook is mounted, Ink turns on bracketed paste mode (`\x1b[?2004h`), so the terminal frames pasted text and Ink stops guessing. `usePaste` and `useInput` compose in the same component because they run on separate channels: with `usePaste` active, paste content never reaches `useInput`.


### useWindowSize

**[Ink 7]** Terminal dimensions that re-render on resize.

```tsx
import { useWindowSize, Box, Text } from "ink";

function App() {
    const { columns, rows } = useWindowSize();

    return (
        <Box width={columns}>
            <Text>{columns}x{rows}</Text>
        </Box>
    );
}
```

Returns `{ columns, rows }` and re-renders the component whenever the terminal resizes. This is the correct source for terminal dimensions; `useStdout().stdout.rows` is not reactive.


### useBoxMetrics

**[Ink 7]** Track a box's measured layout, updating as the layout changes.

```tsx
import { useRef } from "react";
import { Box, Text, useBoxMetrics } from "ink";

function Example() {
    const ref = useRef(null);
    const { width, height, left, top, hasMeasured } = useBoxMetrics(ref);

    return (
        <Box ref={ref}>
            <Text>
                {hasMeasured ? `${width}x${height} at ${left},${top}` : "Measuring..."}
            </Text>
        </Box>
    );
}
```

| Field | Type | Description |
|-------|------|-------------|
| `width` / `height` | `number` | Measured size |
| `left` / `top` | `number` | Offset from the parent's edges |
| `hasMeasured` | `boolean` | Whether the tracked element was measured in the latest layout pass |

Positions are relative to the parent. The hook returns zeros before the first layout pass and whenever the ref is detached, which is what `hasMeasured` distinguishes from a genuine zero. It re-runs on terminal resize, sibling and content changes, and position changes, so unlike [`measureElement`](#measureelement) it needs no effect to stay current.


### useAnimation

**[Ink 7]** Drive frame-based animation without your own timer.

```tsx
import { Text, useAnimation } from "ink";

function Spinner() {
    const { frame } = useAnimation({ interval: 80 });
    const characters = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

    return <Text>{characters[frame % characters.length]}</Text>;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `frame` | `number` | Counter incrementing by 1 each interval. Use for indexed sequences |
| `time` | `number` | Milliseconds since the animation started or last reset. Use for continuous math |
| `delta` | `number` | Milliseconds since the previous rendered tick, accounting for throttled renders. Use for velocity-driven motion |
| `reset` | `() => void` | Reset `frame`, `time`, and `delta` to `0` and restart timing |

Options are `interval` (default `100` ms) and `isActive` (default `true`). Setting `isActive` back to `true` after pausing resets all values to `0`. Every `useAnimation` in the tree shares one internal timer, so several animated components collapse into a single render cycle.


### measureElement

Measure rendered element dimensions.

```tsx
import { useRef, useEffect, useState } from "react";
import { measureElement, Box, Text } from "ink";

function App() {
    const ref = useRef(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (ref.current) {
            // [Changed in 7] 7.1.1 also returns x and y
            const { x, y, width, height } = measureElement(ref.current);
            setDimensions({ width, height });
        }
    }, []);

    return (
        <Box ref={ref} width="50%" padding={2}>
            <Text>Size: {dimensions.width}x{dimensions.height}</Text>
        </Box>
    );
}
```

| Field | Type | Description |
|-------|------|-------------|
| `width` / `height` | `number` | Measured size |
| `x` / `y` | `number` | **[Ink 7]** 0-based column and row within the live layout region, added in 7.1.1 |

`x` and `y` are layout-tree coordinates, accumulated by walking up each ancestor's offset. They are not terminal viewport coordinates, so comparing them against mouse events means converting through the live region's viewport position. That holds in alternate-screen mode too, whenever output such as `<Static>` content sits above the live region.

`measureElement` returns zeros when called during render, before layout runs. Call it from `useEffect`, `useLayoutEffect`, an input handler, or a timer, and pass the changing content as a dependency so it re-measures. [`useBoxMetrics`](#useboxmetrics) does that bookkeeping for you.


## Ink UI Components


Install: `bun add @inkjs/ui` (already a dependency here)

```tsx
import {
    TextInput,
    PasswordInput,
    Select,
    MultiSelect,
    ConfirmInput,
    Spinner,
    ProgressBar,
    Badge,
    StatusMessage,
    Alert,
    UnorderedList,
    OrderedList,
} from "@inkjs/ui";
```

::: warning Only four are usable in noorm
`TextInput` (with `isDisabled`), `Spinner`, `Badge`, and `ProgressBar` are display-only or properly controlled, so they compose with noorm's focus system. `Select`, `MultiSelect`, and `ConfirmInput` drive Ink's internal focus and are **incompatible**—build the equivalent from `useFocusScope` + `useInput` instead. Their sections below are upstream reference only.
:::


### TextInput

```tsx
<TextInput
    placeholder="Enter name..."
    defaultValue=""
    suggestions={["apple", "banana", "cherry"]}
    onChange={(value) => console.log(value)}
    onSubmit={(value) => console.log("Submitted:", value)}
    isDisabled={false}
/>
```


### PasswordInput

```tsx
<PasswordInput
    placeholder="Enter password..."
    onChange={(value) => setPassword(value)}
    onSubmit={(value) => handleLogin(value)}
    isDisabled={false}
/>
```


### Select

```tsx
<Select
    options={[
        { label: "Red", value: "red" },
        { label: "Green", value: "green" },
        { label: "Blue", value: "blue" },
    ]}
    defaultValue="red"
    visibleOptionCount={5}
    highlightText="re"
    onChange={(value) => setColor(value)}
    isDisabled={false}
/>
```


### MultiSelect

```tsx
<MultiSelect
    options={[
        { label: "TypeScript", value: "ts" },
        { label: "JavaScript", value: "js" },
        { label: "Python", value: "py" },
    ]}
    defaultValue={["ts"]}
    onChange={(values) => setLanguages(values)}
/>
```


### ConfirmInput

```tsx
<ConfirmInput
    defaultChoice="confirm"  // or "cancel"
    submitOnEnter={true}
    onConfirm={() => console.log("Confirmed")}
    onCancel={() => console.log("Cancelled")}
/>
```


### Spinner

```tsx
<Spinner label="Loading..." />
```


### ProgressBar

```tsx
// value: 0-100
<ProgressBar value={75} />
```


### Badge

```tsx
<Badge color="green">Pass</Badge>
<Badge color="red">Fail</Badge>
<Badge color="yellow">Warn</Badge>
<Badge color="blue">Info</Badge>
```


### StatusMessage

```tsx
<StatusMessage variant="success">Deployed successfully</StatusMessage>
<StatusMessage variant="error">Deployment failed</StatusMessage>
<StatusMessage variant="warning">Deprecated API</StatusMessage>
<StatusMessage variant="info">Update available</StatusMessage>
```


### Alert

```tsx
<Alert variant="success" title="Success">
    Your changes have been saved.
</Alert>

<Alert variant="error" title="Error">
    Failed to save changes.
</Alert>

<Alert variant="warning">
    This action cannot be undone.
</Alert>

<Alert variant="info">
    A new version is available.
</Alert>
```


### UnorderedList

```tsx
<UnorderedList>
    <UnorderedList.Item>First item</UnorderedList.Item>
    <UnorderedList.Item>Second item</UnorderedList.Item>
    <UnorderedList.Item>
        Nested list:
        <UnorderedList>
            <UnorderedList.Item>Nested item</UnorderedList.Item>
        </UnorderedList>
    </UnorderedList.Item>
</UnorderedList>
```


### OrderedList

```tsx
<OrderedList>
    <OrderedList.Item>First step</OrderedList.Item>
    <OrderedList.Item>Second step</OrderedList.Item>
    <OrderedList.Item>Third step</OrderedList.Item>
</OrderedList>
```


## Meow (Argument Parsing)


::: warning noorm does not use Meow
noorm parses arguments with **citty** (`src/cli/`), and `meow` is not a dependency. This section is kept as general Ink-ecosystem reference; do not add Meow to this repo. For how noorm's commands are defined, see [CLI](/dev/headless).
:::

Meow is a common argument parser for Ink CLI apps. It handles `--help`, `--version`, flags, and positional arguments.

```bash
npm install meow
```


### Basic Setup

```tsx
#!/usr/bin/env node
import meow from 'meow';
import { render } from 'ink';
import { App } from './App.js';

const cli = meow(
    `
    Usage
      $ my-cli <command> [options]

    Commands
      init        Initialize a new project
      build       Build the project

    Options
      --name, -n      Your name
      --verbose, -v   Show verbose output
      --config, -c    Path to config file

    Examples
      $ my-cli init --name=myapp
      $ my-cli build --verbose
`,
    {
        importMeta: import.meta,
        flags: {
            name: {
                type: 'string',
                shortFlag: 'n',
            },
            verbose: {
                type: 'boolean',
                shortFlag: 'v',
                default: false,
            },
            config: {
                type: 'string',
                shortFlag: 'c',
                default: './config.json',
            },
        },
    }
);

// cli.input = ['init'] (positional args)
// cli.flags = { name: 'myapp', verbose: false, config: './config.json' }

render(<App command={cli.input[0]} flags={cli.flags} />);
```


### Flag Types

```tsx
const cli = meow(helpText, {
    importMeta: import.meta,
    flags: {
        // String flag
        name: {
            type: 'string',
            shortFlag: 'n',
            default: 'world',
        },

        // Boolean flag
        verbose: {
            type: 'boolean',
            shortFlag: 'v',
            default: false,
        },

        // Number flag
        count: {
            type: 'number',
            shortFlag: 'c',
            default: 1,
        },

        // Required flag (will error if missing)
        token: {
            type: 'string',
            isRequired: true,
        },

        // Multiple values: --file=a.txt --file=b.txt
        file: {
            type: 'string',
            shortFlag: 'f',
            isMultiple: true,
        },

        // Aliases (multiple short flags)
        debug: {
            type: 'boolean',
            aliases: ['d', 'D'],
        },
    },
});
```


### Accessing Values

```tsx
const cli = meow(helpText, { importMeta: import.meta, flags: { /* ... */ } });

// Positional arguments (non-flag arguments)
cli.input;          // ['arg1', 'arg2']
cli.input[0];       // 'arg1'

// Flags
cli.flags;          // { name: 'value', verbose: true, count: 5 }
cli.flags.name;     // 'value'
cli.flags.verbose;  // true

// Unnormalized flags (preserves original casing)
cli.unnormalizedFlags;  // { 'my-flag': 'value' }

// Package info
cli.pkg;            // Contents of package.json

// Show help
cli.showHelp();     // Prints help and exits with code 0
cli.showHelp(1);    // Prints help and exits with code 1

// Show version
cli.showVersion();  // Prints version from package.json
```


### Conditional Rendering Based on Flags

```tsx
#!/usr/bin/env node
import meow from 'meow';
import { render } from 'ink';
import { App } from './App.js';
import { InitCommand } from './commands/Init.js';
import { BuildCommand } from './commands/Build.js';

const cli = meow(
    `
    Usage
      $ my-cli <command>

    Commands
      init    Initialize project
      build   Build project
`,
    {
        importMeta: import.meta,
        flags: {
            help: { type: 'boolean', shortFlag: 'h' },
        },
    }
);

const [command] = cli.input;

switch (command) {
    case 'init':
        render(<InitCommand />);
        break;
    case 'build':
        render(<BuildCommand />);
        break;
    case undefined:
        cli.showHelp();
        break;
    default:
        console.error(`Unknown command: ${command}`);
        cli.showHelp(1);
}
```


### Validation

```tsx
const cli = meow(helpText, {
    importMeta: import.meta,
    flags: {
        port: {
            type: 'number',
            shortFlag: 'p',
            default: 3000,
        },
        env: {
            type: 'string',
            shortFlag: 'e',
            default: 'development',
        },
    },
});

// Manual validation
const { port, env } = cli.flags;

if (port < 1 || port > 65535) {
    console.error('Error: Port must be between 1 and 65535');
    process.exit(1);
}

const validEnvs = ['development', 'staging', 'production'];
if (!validEnvs.includes(env)) {
    console.error(`Error: env must be one of: ${validEnvs.join(', ')}`);
    process.exit(1);
}

render(<App port={port} env={env} />);
```


### TypeScript Types

```tsx
import meow from 'meow';

// Infer flag types automatically
const cli = meow(helpText, {
    importMeta: import.meta,
    flags: {
        name: { type: 'string' },
        count: { type: 'number', default: 0 },
        verbose: { type: 'boolean', default: false },
    },
});

// cli.flags is typed as:
// {
//   name: string | undefined;
//   count: number;
//   verbose: boolean;
// }

// For explicit typing:
interface Flags {
    name?: string;
    count: number;
    verbose: boolean;
}

const flags = cli.flags as Flags;
```


### Complete CLI Example

```tsx
#!/usr/bin/env node
import meow from 'meow';
import { render } from 'ink';
import { App } from './App.js';

const cli = meow(
    `
    Usage
      $ my-cli [options]

    Options
      --name, -n       Your name (required)
      --greeting, -g   Greeting to use (default: Hello)
      --shout, -s      SHOUT THE GREETING
      --times, -t      Repeat greeting N times (default: 1)
      --help, -h       Show this help
      --version        Show version

    Examples
      $ my-cli --name=World
      $ my-cli -n World -g Hi -s
      $ my-cli --name=World --times=3
`,
    {
        importMeta: import.meta,
        flags: {
            name: {
                type: 'string',
                shortFlag: 'n',
                isRequired: true,
            },
            greeting: {
                type: 'string',
                shortFlag: 'g',
                default: 'Hello',
            },
            shout: {
                type: 'boolean',
                shortFlag: 's',
                default: false,
            },
            times: {
                type: 'number',
                shortFlag: 't',
                default: 1,
            },
        },
    }
);

const { name, greeting, shout, times } = cli.flags;

render(
    <App
        name={name}
        greeting={greeting}
        shout={shout}
        times={times}
    />
);
```


## Patterns


### Screen Navigation

```tsx
type Screen = "home" | "settings" | "about";

function App() {
    const [screen, setScreen] = useState<Screen>("home");

    const screens: Record<Screen, ReactNode> = {
        home: <HomeScreen onNavigate={setScreen} />,
        settings: <SettingsScreen onNavigate={setScreen} />,
        about: <AboutScreen onNavigate={setScreen} />,
    };

    return <>{screens[screen]}</>;
}
```


### Navigation with History

```tsx
function useNavigation<T extends string>(initial: T) {
    const [history, setHistory] = useState<T[]>([initial]);

    return {
        current: history[history.length - 1],
        push: (screen: T) => setHistory([...history, screen]),
        pop: () => setHistory(history.slice(0, -1)),
        canGoBack: history.length > 1,
    };
}
```


### Menu Selection

```tsx
function Menu({ items, onSelect }: { items: string[]; onSelect: (i: number) => void }) {
    const [selected, setSelected] = useState(0);

    useInput((input, key) => {
        if (key.upArrow) {
            setSelected((s) => (s > 0 ? s - 1 : items.length - 1));
        }
        if (key.downArrow) {
            setSelected((s) => (s < items.length - 1 ? s + 1 : 0));
        }
        if (key.return) {
            onSelect(selected);
        }
    });

    return (
        <Box flexDirection="column">
            {items.map((item, i) => (
                <Text key={i} color={i === selected ? "cyan" : "white"}>
                    {i === selected ? "> " : "  "}{item}
                </Text>
            ))}
        </Box>
    );
}
```


### Loading State

```tsx
function LoadingExample() {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<string | null>(null);

    useEffect(() => {
        fetchData().then((result) => {
            setData(result);
            setLoading(false);
        });
    }, []);

    if (loading) {
        return <Spinner label="Loading data..." />;
    }

    return <Text>{data}</Text>;
}
```


### Form with Multiple Inputs

```tsx
function Form() {
    const [step, setStep] = useState(0);
    const [values, setValues] = useState({ name: "", email: "" });

    const steps = [
        <TextInput
            key="name"
            placeholder="Name"
            onSubmit={(value) => {
                setValues((v) => ({ ...v, name: value }));
                setStep(1);
            }}
        />,
        <TextInput
            key="email"
            placeholder="Email"
            onSubmit={(value) => {
                setValues((v) => ({ ...v, email: value }));
                setStep(2);
            }}
        />,
        <Text key="done" color="green">
            Done! Name: {values.name}, Email: {values.email}
        </Text>,
    ];

    return (
        <Box flexDirection="column">
            <Text bold>Step {step + 1} of 3</Text>
            {steps[step]}
        </Box>
    );
}
```


### Task Runner with Static

```tsx
interface Task {
    id: number;
    name: string;
    status: "pending" | "running" | "done";
}

function TaskRunner({ tasks: initialTasks }: { tasks: string[] }) {
    const [completed, setCompleted] = useState<Task[]>([]);
    const [current, setCurrent] = useState(0);

    useEffect(() => {
        if (current >= initialTasks.length) return;

        const timer = setTimeout(() => {
            setCompleted((prev) => [
                ...prev,
                { id: current, name: initialTasks[current], status: "done" },
            ]);
            setCurrent((c) => c + 1);
        }, 1000);

        return () => clearTimeout(timer);
    }, [current, initialTasks]);

    return (
        <>
            <Static items={completed}>
                {(task) => (
                    <Box key={task.id}>
                        <Text color="green">✓ {task.name}</Text>
                    </Box>
                )}
            </Static>

            {current < initialTasks.length && (
                <Spinner label={`Running: ${initialTasks[current]}`} />
            )}

            {current >= initialTasks.length && (
                <Text color="green" bold>All tasks completed!</Text>
            )}
        </>
    );
}
```


### Context for Global State

```tsx
interface AppState {
    user: string | null;
    theme: "light" | "dark";
}

const AppContext = createContext<{
    state: AppState;
    setState: (s: Partial<AppState>) => void;
}>(null!);

function AppProvider({ children }: { children: ReactNode }) {
    const [state, setFullState] = useState<AppState>({
        user: null,
        theme: "dark",
    });

    const setState = (partial: Partial<AppState>) => {
        setFullState((s) => ({ ...s, ...partial }));
    };

    return (
        <AppContext.Provider value={{ state, setState }}>
            {children}
        </AppContext.Provider>
    );
}

function useAppState() {
    return useContext(AppContext);
}
```


## Tips & Gotchas


### Raw Mode Required

Ink needs a real TTY for keyboard input. Running via `npm run start` through a pipe won't work. Run directly:

```bash
node dist/cli.js
```


### All Text Must Be in `<Text>`

```tsx
// Wrong - will error
<Box>Hello</Box>

// Correct
<Box><Text>Hello</Text></Box>
```


### No CSS Units

Ink uses character counts, not pixels:

```tsx
// Width = 50 characters, not pixels
<Box width={50}>...</Box>
```


### Percentage Sizing

Percentages work but need a parent with defined dimensions:

```tsx
<Box width={80}>
    <Box width="50%">  {/* 40 characters */}
        <Text>Half</Text>
    </Box>
</Box>
```


### Console.log Interference

Use `patchConsole: true` in render options, or avoid `console.log`:

```tsx
render(<App />, { patchConsole: true });
```


### Exit Cleanly

Always clean up intervals/timeouts:

```tsx
useEffect(() => {
    const timer = setInterval(() => {}, 1000);
    return () => clearInterval(timer);
}, []);
```


### Focus Management

Only one component should handle input at a time. Upstream does that with the `isActive` option:

```tsx
useInput(handler, { isActive: isFocused });
```

In noorm, guard inside the handler instead. See [Conditional Input](#conditional-input).


### Testing

Use `ink-testing-library`:

```bash
bun add -d ink-testing-library
```

```tsx
import { render } from "ink-testing-library";

const { lastFrame } = render(<App />);
expect(lastFrame()).toContain("Expected text");
```


### Colors in CI

Colors may not display in CI environments. Check `process.stdout.isTTY`.


### Argument Parsing

In noorm, use **citty** — see `src/cli/`. Outside this repo, `meow` and `yargs` are the common choices:

```bash
npm install meow
```

```tsx
import meow from "meow";

const cli = meow(`
    Usage
      $ my-cli <input>

    Options
      --name, -n  Your name

    Examples
      $ my-cli --name=Jane
`, {
    importMeta: import.meta,
    flags: {
        name: {
            type: "string",
            shortFlag: "n",
        },
    },
});

console.log(cli.flags.name);
```
