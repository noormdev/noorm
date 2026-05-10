# noorm CLI / TUI — UI Kit

A high-fidelity HTML recreation of the noorm CLI in a terminal frame.
Lands on a fake interactive session: type `1` (or click the prompt
suggestions) to step through commands.

## Files

- `index.html` — entry point. Loads tokens + components, mounts `<App/>`.
- `TerminalFrame.jsx` — the macOS-style terminal window with traffic
  lights, title bar, and tab.
- `Prompt.jsx` — a single line of CLI output: prompt, command, and the
  rendered result (with mono highlight).
- `TUIMenu.jsx` — the boxy ASCII-bordered menu that appears when you run
  `noorm ui`, with keybind hints.
- `App.jsx` — owns the session log + suggestion state. Click a suggestion
  chip below the prompt to push the next command and its output.

## Note

This is the brand's CLI surface as it should *feel*, not a literal port of
the current `noorm` binary's output. Suggestions are limited to the demo
script: install → init → build → ff → ui.
