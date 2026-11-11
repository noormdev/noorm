#!/bin/sh
# Generates the certificates the enforced-TLS test containers and tests read.
# Usage: scripts/gen-test-tls.sh [output-dir]. Setup: "Live TLS Tests" in docs/dev/ci.md.
set -eu

cd "$(dirname "$0")/.."

OUT="${1:-tests/fixtures/tls/generated}"
SERVER_NAME="db.noorm.test"
CLIENT_USER="noorm_tls"
EXPECTED="ca.pem other-ca.pem client.pem client.key postgres.pem postgres.key mysql.pem mysql.key mssql.pem mssql.key"

complete=yes
for file in $EXPECTED; do
    [ -s "$OUT/$file" ] || complete=no
done

if [ "$complete" = yes ]; then
    echo "TLS fixtures already present in $OUT"
    exit 0
fi

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

# A partial set would mix certificates from two authorities.
rm -rf "$OUT"
mkdir -p "$OUT"
chmod 700 "$OUT"
umask 077
cd "$OUT"

cat > openssl.cnf <<EOF
[req]
distinguished_name = dn
[dn]
[ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[server]
basicConstraints = CA:FALSE
subjectAltName = DNS:$SERVER_NAME
extendedKeyUsage = serverAuth
[client]
basicConstraints = CA:FALSE
extendedKeyUsage = clientAuth
EOF

authority() {
    openssl req -x509 -config openssl.cnf -extensions ca -newkey rsa:2048 -nodes \
        -keyout "$1.key" -out "$1.pem" -days 3650 -subj "/CN=$2" 2>/dev/null
}

signed() {
    openssl req -new -config openssl.cnf -newkey rsa:2048 -nodes \
        -keyout "$1.key" -out "$1.csr" -subj "/CN=$2" 2>/dev/null
    openssl x509 -req -in "$1.csr" -CA ca.pem -CAkey ca.key -CAcreateserial \
        -extfile openssl.cnf -extensions "$3" -days 3650 -out "$1.pem" 2>/dev/null
}

authority ca "noorm test CA"
authority other-ca "noorm unrelated test CA"

for dialect in postgres mysql mssql; do
    signed "$dialect" "$SERVER_NAME" server
done

signed client "$CLIENT_USER" client

# Nothing signs with either authority again, so their keys do not stay on disk.
rm -f ca.key other-ca.key ca.srl ./*.csr openssl.cnf

echo "TLS fixtures written to $OUT"
