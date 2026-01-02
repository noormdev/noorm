# Building a CLI Router for Ink


## Overview

This document outlines architectural patterns for implementing a custom CLI router for an Ink-based TUI application. Since Pastel (the Next.js-inspired framework for Ink) is incompatible with Ink v6, we need our own lightweight router that provides:

1. **CLI argument parsing** - Map shell commands to routes
2. **In-app navigation** - Navigate between screens with history
3. **Screen rendering** - Render the correct component for each route
4. **Dual-mode support** - TUI mode and headless mode for CI/CD


## Architecture Comparison


### Pastel's Approach

Pastel uses file-based routing (like Next.js):

```
commands/
├── index.tsx           → mycli
├── config.tsx          → mycli config
└── config/
    ├── add.tsx         → mycli config add
    └── edit.tsx        → mycli config edit <name>
```

**Pros:** Convention over configuration, auto-discovery
**Cons:** Requires build step, file system coupling, magic


### Our Approach: Explicit Registry

We use an explicit route registry with meow for CLI parsing:

```
src/cli/
├── index.tsx           # Entry point + meow setup
├── router.tsx          # React context for navigation
├── screens.tsx         # Route → Component registry
└── screens/
    ├── home.tsx
    ├── config/
    │   ├── list.tsx
    │   ├── add.tsx
    │   └── edit.tsx
    └── ...
```

**Pros:** Type-safe, explicit, no magic, works with any bundler
**Cons:** Manual registration required


## Core Concepts


### Route Types

Define a union type of all valid routes for compile-time safety:

- Use string literal unions for route names (e.g., `'home' | 'config' | 'config/add'`)
- Consider hierarchical naming with `/` separators to group related routes
- Define a `RouteParams` interface for dynamic parameters (name, path, count, etc.)
- Track navigation history as an array of `{ route, params }` entries


### Router Context

The router should be implemented as a React context that manages:

- **Current route** - The active route string
- **Route params** - Dynamic parameters for the current route
- **History stack** - Previous routes for back navigation

Key actions to expose:

- `navigate(route, params)` - Push a new route onto history
- `back()` - Pop and navigate to previous route
- `replace(route, params)` - Replace current route without history
- `reset()` - Clear history and return to home


**Deep Route Initialization**

When the CLI starts with a deep route (e.g., `noorm settings/secrets/add`), the router builds ancestral history automatically. This ensures back navigation works correctly:

```
Initial route: 'settings/secrets/add'
Built history: ['home', 'settings', 'settings/secrets']
```

The `buildAncestorHistory` function uses `getParentRoute` to walk up the route hierarchy, building the stack so pressing Escape navigates through parents correctly.


### Provider Hierarchy

The app requires a specific nesting order for providers:

```
ShutdownProvider      # Lifecycle management, graceful exit
└── AppContextProvider    # State/settings orchestration, observer subscriptions
    └── ToastProvider     # Toast notifications
        └── FocusProvider     # Focus stack management
            └── RouterProvider    # Navigation state
                └── GlobalKeyboard    # Ctrl+C, Escape handling
                    └── AppShell      # Screen rendering
```

Key providers:

- **ShutdownProvider** - Manages `LifecycleManager`, provides `useShutdown()` hook
- **AppContextProvider** - Loads state/settings, subscribes to observer events
- **ToastProvider** - Toast queue with `useToast()` hook
- **FocusProvider** - Custom focus stack (not Ink's built-in focus)


### Screen Registry

Map routes to React components using a simple record:

- Consider `React.lazy()` for code-splitting in larger apps
- Direct imports work fine for smaller CLIs
- Wrap rendering in `React.Suspense` for lazy-loaded screens
- Handle unknown routes gracefully with an error screen


### CLI Entry Point with meow

Use [meow](https://github.com/sindresorhus/meow) for CLI argument parsing. Meow provides:

- Automatic help text generation
- Flag parsing with type coercion
- Version display from package.json
- camelCase flag conversion

**Pattern: Subcommand Routing**

Since meow doesn't have built-in subcommand support like Commander, route based on positional arguments:

```
mycli                    → input: []           → route: 'home'
mycli config             → input: ['config']   → route: 'config'
mycli config add         → input: ['config', 'add'] → route: 'config/add'
mycli config edit foo    → input: ['config', 'edit', 'foo'] → route: 'config/edit', params: { name: 'foo' }
```

**Suggested approach:**

1. Parse `cli.input` array to determine the route
2. Extract remaining positional args as route parameters
3. Pass `cli.flags` as additional context (headless mode, verbose, etc.)
4. Start the app with resolved route and params


## Advanced Patterns


### Global Keyboard Handler

Add consistent keyboard shortcuts across all screens:

- `q` to quit the application
- `Escape` to go back (when history exists)
- Consider a wrapper component that uses Ink's `useInput` hook
- Prevent duplicate handlers by managing focus appropriately

Available keyboard helper hooks in `src/cli/keyboard.tsx`:

- **`useFocusedInput(isFocused, handler)`** - Wraps `useInput` with focus checking
- **`useListKeys(options)`** - List navigation (up/down, enter selection)
- **`useQuitHandler()`** - Graceful shutdown on Ctrl+C


### Headless Mode for CI/CD

Support non-interactive execution for scripts and CI pipelines:

- Detect headless mode via `process.env.CI` or `!process.stdout.isTTY`
- Allow explicit `--headless` flag override
- In headless mode, execute commands directly and output JSON/text to stdout
- Skip TUI rendering entirely in headless mode


### Route Guards

Add logic that runs before navigation:

- Validate required params exist before allowing navigation
- Redirect to fallback routes when guards fail
- Useful for routes that require a selected config or authenticated state


### Section-Based Navigation

Group routes by section for tab-style navigation:

- Extract section from route string (e.g., `'config/add'` → section: `'config'`)
- Enable parent route navigation (e.g., `'config/add'` → parent: `'config'`)
- Useful for breadcrumb-style navigation or tab highlighting


## File Structure

```
src/cli/
├── index.tsx              # Entry point, meow setup
├── app.tsx                # Root App component
├── router.tsx             # Router context and hooks
├── screens.tsx            # Route → Component registry
├── keyboard.tsx           # Global keyboard handler
├── types.ts               # Type definitions
└── screens/
    ├── home.tsx
    ├── config/
    │   ├── list.tsx
    │   ├── add.tsx
    │   ├── edit.tsx
    │   └── rm.tsx
    └── ...
```


## Comparison: Our Router vs Pastel

| Feature          | Pastel             | Our Router            |
| ---------------- | ------------------ | --------------------- |
| Route Definition | File-based (magic) | Explicit registry     |
| Type Safety      | Zod schemas        | TypeScript unions     |
| CLI Parsing      | Built-in           | meow                  |
| Ink Version      | v4 only            | v6 compatible         |
| Code Splitting   | Automatic          | Manual (React.lazy)   |
| Build Step       | Required           | Optional              |
| Learning Curve   | Next.js familiar   | React Router familiar |
| Bundle Size      | Larger             | Minimal               |


## Alternatives Considered


### Commander.js

Full-featured CLI framework with subcommand support. More complex than needed for routing to a TUI - meow's simplicity is a better fit when the TUI handles most interaction.


### React Router / Wouter

Designed for URL-based routing which doesn't map well to CLI navigation. Adds unnecessary complexity for our use case.


### Custom State Machine (XState)

Overkill for simple navigation. Better suited for complex multi-step workflows within a single screen rather than screen-to-screen navigation.


### Wait for Pastel v3

Pastel may eventually support Ink v6. However, building our own gives us full control and no external dependency risk.


## Considerations


### Complexity Factors

| Component       | Notes                             |
| --------------- | --------------------------------- |
| Types           | Union types, params interface     |
| Router Context  | State management, history stack   |
| Screen Registry | Lazy loading optional             |
| meow Setup      | Subcommand parsing from input     |
| Global Keyboard | Ink useInput integration          |
| Headless Mode   | Alternative execution path        |

Most effort goes into:

1. Writing individual screen components
2. Defining the route-to-input mapping logic
3. Implementing headless command handlers (if needed)


## Conclusion

Building a custom router for Ink v6 is a pragmatic choice that:

- Keeps dependencies minimal
- Provides full type safety
- Supports both TUI and headless modes
- Requires no build-time magic
- Is simple enough to understand and maintain

The router infrastructure is lightweight, with most complexity in the screen components themselves.
