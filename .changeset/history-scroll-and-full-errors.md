---
"@noormdev/cli": minor
---

Make the execution history and file-execution screens scroll, and let a failed
file's error be read in full.

Both screens drew a fixed window — `slice(0, 15)` of the history, `slice(0, 20)`
of the files — while their selection cursor ranged over every record. Past that
window the arrow keys still moved a selection that was not on screen, and the
detail box under the list described a record the reader could not see, so the
screens were not merely unscrollable: they were reporting on rows that had
scrolled out from under the cursor. Both now use `SelectList`, which owns the
cursor and the window together and sizes itself from the terminal, so what is
selected is always drawn and a tall terminal shows more rows rather than the same
fifteen. The history list also fetches 200 records instead of 50, now that
reaching past the fifteenth is possible.

A failed file's error message was rendered as one line per `\n`, with no bound.
A stack trace therefore pushed the file list, the detail box and the hotkey hints
off the bottom together — and on the history screen the same message was cut at
80 characters instead, which drops the part that names the constraint or the
syntax error. Both screens now show a bounded single line in the detail box and
open the whole message, wrapped and scrollable, on a keypress: `e` on the history
screen, Enter on a file execution.

`SelectList` gains an optional `renderItem`, which lets a screen draw its own row
body while the list keeps the cursor, the window, the scroll indicators, focus and
the mouse. Without it these two screens would have had to give up the per-status
colour a reader scans a history list for, which is why they had their own list in
the first place.
