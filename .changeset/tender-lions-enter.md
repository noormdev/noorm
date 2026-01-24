---
"@noormdev/cli": minor
---

## Auto-Update Notifications

### CLI

- **Background Update Checking**: Checks npm registry on TUI launch
  - Toast notification for available minor/patch updates
  - Warning toast for major version updates
  - Respects user preferences in `~/.noorm/settings.yml`

- **Global Settings**: User-level preferences at `~/.noorm/settings.yml`
  - `checkUpdates`: Enable/disable update checking (default: true)
  - `autoUpdate`: Auto-install non-major updates (default: false)
  - `dismissable`: Per-alert "don't ask again" preferences

- **DismissableAlert Component**: Reusable confirmation dialogs
  - Auto-resolves based on stored preference ('always'/'never'/'ask')
  - Keyboard navigation with arrow keys and number shortcuts
  - Optional "Don't ask again" checkbox with persistence

### SDK

- New `src/core/update/` module with:
  - `checkForUpdate()`: Version comparison with prerelease channel support
  - `installUpdate()`: Background npm install via child process
  - `loadGlobalSettings()` / `saveGlobalSettings()`: User preferences
  - `getDismissablePreference()` / `updateDismissablePreference()`: Alert state

- New observer events: `update:checking`, `update:available`, `update:complete`, etc.
