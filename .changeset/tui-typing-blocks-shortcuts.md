---
'@noormdev/cli': patch
---

Stop global TUI shortcuts from firing while you type. A capital `L` or `Q` typed into a form field, search box, or the SQL editor used to open the log viewer or the SQL terminal, and `?`, `D`, and `F` could open help or toggle dry-run and force mode. While a text field is taking input, those keys now type their character.
