---
id: pr-120-review-fixes-f-26
title: check-flag-placement.sh scans the VitePress build output
created: "2026-11-09"
origin: |
    PR 120 review fixes, CP6 iteration 1 reviewer.
kind: finding
severity: risk
review_by: "2027-01-08"
status: open
file: scripts/check-flag-placement.sh
---

`scripts/check-flag-placement.sh`

The script greps all of `docs/`, including the gitignored `docs/.vitepress/dist`, so it reports a hit from `dist/cli/flags.html` whenever a local docs build exists. Exclude `docs/.vitepress/dist`.

Origin: CP6 iteration 1 reviewer.
