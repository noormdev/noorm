---
id: legacy-protected-removal-trigger
title: Legacy 'protected' input path has no removal trigger; export still mints it
created: "2026-07-08"
origin: |
    challenge-swarm #40 (migration F5, tester F7, maintainer F6)
kind: finding
severity: nit
review_by: "2026-09-06"
status: open
file: src/core/config/schema.ts:44; src/tui/screens/config/ConfigExportScreen.tsx:142
---

'Accepted for one version then removed' appears in 8 places but nothing operationalizes it — no version-keyed guard test, no tracked removal. Export actively writes protected:guarded(config) into every new export. Classic permanent-temporary: 3 accept-sites + 1 produce-site, 0 removal triggers. Add a test keyed to CURRENT_VERSIONS.state that fails when state version advances past 2 with the legacy input path still present.
