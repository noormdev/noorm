---
"@noormdev/cli": patch
---

Display template errors during dry-run in UI feedback

Template rendering errors during dry-run were silently captured in results but never emitted via the observer event system, making them invisible in the UI. Now `file:dry-run` events include status and error fields, and the progress hook properly tracks failed dry-runs.
