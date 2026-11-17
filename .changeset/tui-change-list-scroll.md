---
"@noormdev/cli": patch
---

TUI: the Changes screen scrolls. It drew every change at once, so a project with more changes than the terminal had rows squashed the list, hid the newest changes and pushed the status bar off screen; it now windows around the cursor with `↑ N more` / `↓ N more` lines, keeps its detail box to three lines, and drops the box on a terminal too short to hold it. Every terminal-sized list (select lists, searchable lists, the file picker) now counts its scroll-indicator lines in its row budget instead of drawing one or two rows past it.
