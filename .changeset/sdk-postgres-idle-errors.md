---
'@noormdev/sdk': patch
---

Report idle and checked-out PostgreSQL connection failures to the observer without exposing driver error details. Keep pinned sessions on their original connection so subsequent queries reject instead of silently retrying, and retain the pool's disposal of broken clients.
