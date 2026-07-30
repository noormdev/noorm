---
"@noormdev/cli": minor
"@noormdev/sdk": minor
---

## Added

* `feat(identity):` Record the detected agent harness in operation provenance. When a session runs under a recognised agent harness, `executed_by` is suffixed with `(via <harness>)` — so a change applied by an agent is distinguishable from one a human applied. Stamped at the shared insert seam, so change operations, resets and run operations all carry it on every dialect.
* `feat(cli):` `noorm info` reports the detected harness and the environment variables that identified it, so an agent-driven session is visible rather than silent.

Provenance is folded into the existing identity string rather than a new column: the audit question is binary, and a suffix answers it without a four-dialect schema migration. It is not an attestation — `executed_by` is unauthenticated free text and harness detection reads caller-controlled environment variables, so the suffix records what noorm observed, not a proven claim.
