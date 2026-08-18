---
"@noormdev/cli": minor
---

## TUI

### Added

* `feat(tui):` The interactive UI now draws in the alternate screen at full terminal height, and restores the terminal on exit instead of leaving itself in scrollback.
* `feat(tui):` Forms are a two-column layout with browse and edit modes. Arrow keys move between fields on every field type including selects, `Enter` opens a field and commits it, `Esc` reverts it, and submit is a `[ Save ]` row you navigate to.
* `feat(tui):` Lists size themselves to the terminal instead of a fixed row count, and keep their cursor when you leave a screen and come back.
* `feat(explore):` `r` on a table shows its first and last rows, ordered by primary key. `Enter` opens a row as YAML or JSON, `f` switches format, and the arrow keys walk between rows.
* `feat(explore):` The detail screen scrolls, and `v` shows a value the column grid had to truncate.
* `feat(sql):` Wide result grids drop whole columns behind a `… N more columns` marker rather than squeezing every column past legibility. `Enter` opens a row in full.
* `feat(tui):` Mouse support: click to move the cursor, double-click to activate, wheel to scroll. Set `ui.mouse: false` in `.noorm/settings.yml` to restore click-drag text selection.
* `feat(db):` `Esc` cancels a connection test or query that is hanging. On PostgreSQL and MySQL the server is asked to stop the query; on SQL Server and SQLite the client stops waiting and says so.

### Fixed

* `fix(sql):` Backspace in the results filter did nothing, because the key reports as `delete` on the previous Ink release.
* `fix(tui):` Screens sized from the terminal never recomputed on resize.
* `fix(explore):` Column, index and parameter lists re-flowed per row, so the type column landed on a different offset on nearly every row.
* `fix(explore):` "Total Objects" counted categories the screen does not list, so it exceeded the rows a reader could see.
* `fix(tui):` The help screen and log viewer drew past the bottom of the window, putting their first lines out of reach.
