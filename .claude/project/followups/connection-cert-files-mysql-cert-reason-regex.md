---
id: connection-cert-files-mysql-cert-reason-regex
title: MySQL certificate hint depends on mysql2 message wording
created: "2026-11-11"
origin: |
    docs/spec/connection-cert-files.md, final audit and reviews
kind: finding
severity: risk
review_by: "2027-01-10"
status: open
file: src/core/connection/errors.ts:113
---

mysql2 overwrites the TLS error code with HANDSHAKE_SSL_ERROR, so MYSQL_CERTIFICATE_REASONS recovers the certificate code from message text (self-signed, issuer, expired, altnames). A wording change in mysql2 or the runtime's TLS library silently drops the hint; tests pin the wordings seen under Bun 1.4 and Node 24. Ask upstream to preserve the original code on the error, or re-check the wordings on each mysql2 upgrade.
