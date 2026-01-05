# Project Discovery


## The Problem

Users don't always run noorm from the project root. They might be in `~/projects/myapp/packages/db/` when they type `noorm change ff`. The CLI needs to find the project's `.noorm/` directory regardless of where the user is.

But there's a complication: `~/.noorm/` exists too. That's the global directory for identity keys and secrets—not a project. The CLI must distinguish between "user's global noorm" and "actual project".


## How Discovery Works

When noorm starts, it walks up the directory tree from the current working directory:

```
~/projects/myapp/packages/db/     <- user runs noorm here
~/projects/myapp/packages/        <- no .noorm, keep walking
~/projects/myapp/                 <- found .noorm/ → project root!
```

The walk stops at the user's home directory. If `.noorm/` is only found in `~/`, that's the global directory—not a project.

```
~/projects/newapp/src/            <- user runs noorm here
~/projects/newapp/                <- no .noorm
~/projects/                       <- no .noorm
~/                                <- has ~/.noorm but that's global, stop
                                  <- result: no project found
```

Once a project is found, noorm calls `process.chdir()` to the project root. This means all relative paths (settings, changes, SQL files) work correctly without modification.


## Directory Hierarchy

| Path | Purpose | Treated as project? |
|------|---------|---------------------|
| `~/.noorm/` | Global identity, secrets | No |
| `~/projects/myapp/.noorm/` | Project settings, state | Yes |
| `~/projects/myapp/packages/db/` | Subdirectory | Walks up to find project |


## API

```typescript
import {
    findProjectRoot,
    initProjectContext,
    isNoormProject,
    getGlobalNoormPath,
    hasGlobalNoorm,
} from './core/project.js'

// Find project root without side effects
const result = findProjectRoot()
// result.projectRoot: '/Users/me/projects/myapp' or null
// result.hasProject: true/false
// result.homeNoorm: '/Users/me/.noorm' or null
// result.originalCwd: where the user actually ran the command

// Find and chdir to project root (default behavior)
const result = initProjectContext()
// Now process.cwd() === result.projectRoot

// Find without chdir (for SDKs, testing)
const result = initProjectContext({ chdir: false })

// Helper functions
isNoormProject('/path/to/dir')    // checks if dir has .noorm/
getGlobalNoormPath()               // returns ~/.noorm path
hasGlobalNoorm()                   // checks if ~/.noorm exists
```


## CLI Integration

The CLI calls `initProjectContext()` at the very start of `main()`:

```typescript
async function main(): Promise<void> {
    // First thing: find project and chdir
    const projectDiscovery = initProjectContext()

    // Now process.cwd() is the project root
    enableAutoLoggerInit(process.cwd())

    // ... rest of CLI initialization
}
```

If no project is found and the user is heading to the home screen, they're redirected to the init screen to create a project.


## SDK Usage

SDKs might want discovery without the automatic `chdir`:

```typescript
import { findProjectRoot } from 'noorm/core'

// Find project root
const { projectRoot, hasProject } = findProjectRoot()

if (!hasProject) {
    throw new Error('No noorm project found')
}

// Pass projectRoot explicitly to managers
const settings = new SettingsManager(projectRoot)
const state = new StateManager(projectRoot)
```


## Edge Cases

**Symlinks**: On macOS, `/var/folders/...` is symlinked to `/private/var/folders/...`. The discovery uses `realpathSync` to resolve symlinks before comparing paths.

**Multiple projects**: If nested projects exist (unlikely but possible), the nearest one wins:

```
~/projects/outer/.noorm/
~/projects/outer/inner/.noorm/    <- user is here
                                  <- inner project found, not outer
```

**No project, has identity**: User has `~/.noorm/` with identity keys but no project. They're redirected to init to create a project in the current directory.

**No project, no identity**: First-time user. They're redirected to init for identity creation, then project creation.
