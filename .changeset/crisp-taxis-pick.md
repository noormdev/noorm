---
"@noormdev/cli": major
"@noormdev/sdk": major
---

## Template Inspector & Execution Control

### CLI

- **Template Inspector Screen** (`run/inspect`, `[i]` shortcut): New dedicated screen for debugging SQL templates
  - Categorized context view (data files, helpers, built-ins, config, secrets, environment)
  - Array shape detection to debug property access failures
  - Template preview with render error display
  - Refresh support for iterative debugging

- **Rerun Confirmation**: Pre-execution file status check with dialog
  - Shows count of new, previously-run, changed, and failed files
  - Confirmation prompt before re-running previously-executed files
  - `[r]` retry shortcut in all run screens (respects `--force` flag)

- **Execution Cancellation**: `[c]` to abort long-running operations
  - Destroys connection to cleanly stop execution
  - Shows "Execution cancelled" error state

- **Unified KeyHandler Pattern**: Replaced per-screen focus handlers with flexible KeyHandler component

### SDK

- `checkFilesStatus()` function for pre-execution file status categorization
- New types: `FileStatusCategory`, `FileStatusResult`, `FilesStatusResult`
