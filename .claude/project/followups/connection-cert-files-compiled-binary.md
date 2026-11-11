---
id: connection-cert-files-compiled-binary
title: Verify certificate files in the compiled CLI binary
created: "2026-11-11"
origin: |
    docs/spec/connection-cert-files.md, final audit and reviews
kind: finding
severity: question
review_by: "2027-01-10"
status: open
file: scripts/build-binary.mjs
---

Certificate file reading (ssl.caFile, certFile, keyFile), the ~/ expansion and the NODE_EXTRA_CA_CERTS advice in the certificate hint were exercised under the Bun runtime and under Node 24 through packages/sdk/dist, never in the standalone binary from bun run build:binary. Build the binary and connect to a TLS server with a private CA from a file (the local MySQL 8 test container has one: docker exec noorm-test-mysql cat /var/lib/mysql/ca.pem) before the release that ships this. docs/design/enterprise-connectivity.md still calls NODE_EXTRA_CA_CERTS unverified in the compiled binary; drop that caveat once checked.
