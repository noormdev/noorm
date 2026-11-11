---
"@noormdev/cli": minor
---

TUI: forms and confirm dialogs answer mouse clicks (click a field, toggle a checkbox, click Submit/Cancel or Yes/No, wheel between fields). A long value no longer wraps and pushes the action row off screen: form values, list rows, panel titles, log rows and Home rows truncate with `…`, and an open text field scrolls around its cursor. Press `x` on a password field to empty it before typing a replacement. New `noorm config set-password <name> [value] [--stdin]` stores a rotated database password headlessly under the config's `config:write` policy.
