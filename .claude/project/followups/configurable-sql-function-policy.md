---
id: configurable-sql-function-policy
title: Configurable per-config SQL function allow/deny list + TUI editor
created: "2026-07-08"
origin: |
    user idea 2026-07-08, post-#40
kind: plan
severity: question
review_by: "2026-09-06"
status: open
file: src/core/policy/classify.ts:79 (DESTRUCTIVE_FUNCTIONS)
---

Make the hardcoded DESTRUCTIVE_FUNCTIONS denylist user-extensible and DB-embedded.

Model (proposed): per-config sqlFunctionPolicy { mode: 'denylist'|'allowlist' (mutually exclusive), functions: string[] (schema-qualified supported) }, persisted in encrypted state (new schemaVersion migration), so it travels with the project.

THREE-BUCKET SEMANTICS (critical — the user lists govern ONLY the unknown/custom bucket, never the internals):

1. Known-pure builtins (count, min, max, avg, sum, now, coalesce, lower, upper, …): ALWAYS `read`. NEVER subject to the user's lists. An allowlist must not cause `SELECT count(*)` to be denied — this is the explicit user requirement.
2. Known-destructive builtins (pg_terminate_backend, dblink_exec, query_to_xml family, …): the baseline denylist, always bump to >=write.
3. Unknown / user-custom functions (everything not in bucket 1 or 2): the ONLY bucket the config governs.
   - denylist mode: user names the dangerous customs -> those bump to >=write; other unknowns stay read (fail-open guardrail). Extends today's behavior.
   - allowlist mode: user names the safe customs -> those stay read; every OTHER unknown -> treated as write -> denied for viewer (fail-closed sandbox). Bucket 1 stays read regardless; also closes the disclosure gap (pg_read_file, if unlisted, -> denied for viewer). "allowlist" = "deny unrecognized customs not listed", NOT "deny everything not listed".

Implies the classifier needs an explicit KNOWN_PURE builtin set (bucket 1) alongside the existing DESTRUCTIVE set (bucket 2), so allowlist mode can exempt internals.

Per-role differentiation is FREE via the existing matrix — no per-role lists needed. A denylisted function reclassifies to write/ddl; the matrix already says admin CAN write and viewer CANNOT. So the user's example ("my sensitive admin-only proc the MCP viewer must not call") works with a SINGLE per-config list: admin keeps calling it, viewer is denied. v1 = one per-config list + reclassify + existing matrix. A finer viewer-vs-operator split on the same custom function would need per-role lists — defer unless asked.

Layer: consumed by the CLASSIFIER (classifyStatements takes the config's function policy, or a post-classify refinement step that has the called-function set), then the EXISTING role matrix gates unchanged. One enforcement path; no parallel per-role permission engine.

TUI: a screen that POPULATES the picker from live DB introspection (explore domain already has list_functions) — show actual functions/procedures as a checklist, toggle mode, check the sensitive ones. Encrypted, per-config.

CAUTION (hard boundary): configurable FUNCTION lists only. Do NOT make the role->permission MATRIX user-editable — #40 deliberately fixed the three roles in-app ('User-defined or custom roles ... out of scope'). Keep that constraint.

Size: comparable to one CP (state schema + migration, classifier change, TUI screen + introspection wiring, tests). Separate PR after #40 ships. This turns the hardcoded denylist into the default rather than the whole answer.
