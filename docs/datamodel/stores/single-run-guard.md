---
kind: other
title: Single-run admission guard
description: Abstract optional coordination for protected admission and ownership recovery.
---

This represents the required coordination contract, not a proposed table, cache, lock implementation, or established durable storage. When protection is enabled, admission must atomically claim ownership with pending run intent, or use an equivalent race-free protocol, scoped to resolved config and slug. A pending owner blocks another protected admission. The existing [[lock]] table's unique config scope cannot establish this contract. Unprotected invocations overlap by default.

Release only an owned guard after workflow SQL and transaction activity have settled, including after audit failure. Ownership alone is insufficient. If activity may still be running, retain protection for reconciliation. Crashes require an ownership and recovery rule that considers unresolved history and cannot silently treat pending work as complete or permit overlap with still-running SQL; the mechanism and stale recovery remain open.

## Sample values

| config_name | slug | conceptual state | consequence |
| --- | --- | --- | --- |
| dev | refresh-reporting | protected pending owner 1062 | competing protected admission is busy; no new run row |
| dev | refresh-reporting | no protection requested | 1060 and 1061 may overlap |
| dev | refresh-reporting | ownership or SQL completion uncertain | reconcile before deciding protected admission; no assumed expiry rule |
| staging | refresh-reporting | protected owner 1066 with completed steps and confirmed commit | release the owned guard after finalization |
