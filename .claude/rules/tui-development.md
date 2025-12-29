---
paths: src/cli/**/*.{ts,tsx}, tests/cli/**/*.{ts,tsx}
---

# TUI Development Rules


## Focus System

Use `useFocusScope` from `src/cli/focus.tsx` for keyboard input. @inkjs/ui's focus system (`useFocus`, `useFocusManager`) does not communicate with ours - mixing them causes lost input.

```tsx
const { isFocused } = useFocusScope('my-component')

useInput((input, key) => {
    if (!isFocused) return
    // handle input
})
```

Check `isFocused` inside the handler, not via `{ isActive }` option. The option prevents handler registration when false, and `isFocused` is false on initial render before useEffect runs.


## @inkjs/ui Components

Build custom interactive components using `useFocusScope` + `useInput`. @inkjs/ui's `Select`, `MultiSelect`, `ConfirmInput` use ink's internal focus, incompatible with our stack.

Use `TextInput` (with `isDisabled`), `Spinner`, `Badge`, `ProgressBar`. These are display-only or properly controlled.


## Keyboard Handling

Guard all `useInput` handlers with `isFocused` check. Ink's useInput is subscriber-based - all handlers receive every keystroke.

Skip arrow keys in parent when child handles them (e.g., select fields). Otherwise parent intercepts before child can respond.


## Screen Focus Ownership

When a screen's primary content is a Form or other focusable component, do NOT create a competing focus scope at the screen level. Let the child component own focus.

**Bad - competing scopes:**
```tsx
function MyScreen(): ReactElement {
    const { isFocused } = useFocusScope('MyScreen')  // ❌ Competes with Form
    return <Form focusLabel="MyForm" ... />
}
```

**Good - Form owns focus:**
```tsx
function MyScreen(): ReactElement {
    // No useFocusScope here - Form handles it
    return <Form focusLabel="MyForm" ... />
}
```

For screens with multiple states (error state vs form), use separate components with their own focus:

```tsx
function MyScreen(): ReactElement {
    if (!activeConfig) {
        return <ErrorState />  // Has its own useFocusScope
    }
    return <Form ... />  // Form has its own focusLabel
}
```


## Observer Hooks

Use hooks from `src/cli/hooks/useObserver.ts` for event subscriptions. These handle cleanup automatically.

```tsx
import { useOnEvent, useOnceEvent, useEmit, useEventPromise } from '../hooks/index.js'

// Subscribe to events - cleanup on unmount
useOnEvent('changeset:complete', (data) => {
    setResults(prev => [...prev, data])
}, [])

// One-time subscription
useOnceEvent('build:complete', (data) => setFinalResult(data), [])

// Emit events via memoized callback
const emitStart = useEmit('build:start')
emitStart({ schemaPath, fileCount })

// Promise-based with state management
const [result, error, pending, cancel] = useEventPromise('build:complete')
if (pending) return <Spinner />
```


## Testing

Wait after render before sending input. Focus stack initializes in useEffect. Call `unmount()` to clean up stdin handlers.

```tsx
render(<FocusProvider><MyComponent /></FocusProvider>)
await new Promise(r => setTimeout(r, 50))
stdin.write('\x1b[B')  // Down: \x1b[B, Up: \x1b[A, Enter: \r, Esc: \x1b
await new Promise(r => setTimeout(r, 50))
unmount()
```
