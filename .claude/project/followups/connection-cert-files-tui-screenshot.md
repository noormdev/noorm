---
id: connection-cert-files-tui-screenshot
title: Regenerate the add-config screenshot
created: "2026-11-11"
origin: |
    docs/spec/connection-cert-files.md, final audit and reviews
kind: finding
severity: nit
review_by: "2027-01-10"
status: open
file: docs/tui.md:206
---

docs/public/image/tui/config-add.png shows the add form without the five SSL fields (Use SSL, CA File, Client Cert File, Client Key File, TLS Server Name). Regenerate with cd docs/tapes && ./shots.sh (needs vhs; 04-screenshots.tape line 67 writes the still). The form now scrolls, so the tape's key presses may need adjusting.
