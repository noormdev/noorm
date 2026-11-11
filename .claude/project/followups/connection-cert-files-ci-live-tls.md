---
id: connection-cert-files-ci-live-tls
title: Add a live TLS integration test in CI
created: "2026-11-11"
origin: |
    docs/spec/connection-cert-files.md, final audit and reviews
kind: finding
severity: nit
review_by: "2027-01-10"
status: open
file: .github/workflows/ci.yml:105
---

No CI test performs a real TLS handshake with a certificate read from a file; the proof is unit-level plus manual live runs during review. The MySQL 8 service container generates its own CA. ci.yml already runs docker exec against that container, so a step can write the public CA to a file (docker exec ... cat /var/lib/mysql/ca.pem; docker cp failed locally) and an integration test can cover: ssl.caFile connects; tlsServerName equal to the certificate CN connects; a wrong tlsServerName is rejected; ssl true with no CA is rejected with the ssl.caFile hint.
