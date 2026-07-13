---
id: v1-38-sdk-integration-f-2
title: dt reader .dtz bad-path hangs instead of rejecting (unforwarded gunzip stream error)
created: "2026-07-13"
origin: |
    docs/spec/v1-38-sdk-integration.md, iter 3 implementer (CP-3)
kind: finding
severity: risk
review_by: "2026-09-11"
status: open
file: src/core/dt/reader.ts
---

src/core/dt/reader.ts #createReadableStream() pipes fileStream into gunzip for .dtz paths and returns gunzip. .pipe() does not forward the source 'error' event and nothing listens on fileStream, so an ENOENT (or any read error) on a .dtz path becomes an unhandled stream error that hangs the process (15s+, reproducible) instead of rejecting the reader.open() promise. Any caller passing a bad .dtz path hits this. Surfaced while writing v1-38 CP3 case (c), which was switched to .dt to avoid it. Fix: attach an 'error' handler on fileStream that surfaces through the attempt(() => reader.open()) boundary.
