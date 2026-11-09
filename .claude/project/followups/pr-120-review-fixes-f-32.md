---
id: pr-120-review-fixes-f-32
title: SDK pipelines.run does not pass its abort signal to the context builder
created: "2026-11-09"
origin: |
    PR 120 review fixes, docs review
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: src/sdk/namespaces/pipelines.ts:47
---

SDK `pipelines.run` does not pass `options.signal` into `buildPipelineContext`, so an abort that lands during schema migration lets the vault-key and secret lookups run; the executor then records an interrupted run. Forwarding the signal makes an already-aborted run throw `AbortError` before admission instead of resolving `interrupted`, a public SDK change, and the CLI maps an `AbortError` to exit 1 "Pipeline execution failed". Decide the contract, then forward the signal and add an AbortError branch to `pipelineFailure`.
