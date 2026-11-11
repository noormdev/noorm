---
id: connection-cert-files-import-preview-privileges
title: Import preview omits isTest and access roles from the file
created: "2026-11-11"
origin: |
    docs/spec/connection-cert-files.md, TUI-scope audit Q-3
kind: finding
severity: risk
review_by: "2027-01-10"
status: open
file: src/tui/screens/config/ConfigImportScreen.tsx:418
---

The TUI import preview shows the incoming TLS settings but not the isTest flag or the access roles the file carries. The import saves both, and both decide privileges on the imported config. Show them in the preview so the person importing sees what they accept.
