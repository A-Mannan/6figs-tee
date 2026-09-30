#!/usr/bin/env bash
# Run the enclave locally with mock attestation and deterministic balances, then
# exercise a full registration against it. Intended for development only.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -d node_modules ]]; then
  echo "==> Installing dependencies"
  npm install --no-audit --no-fund
fi

echo "==> Running tests"
npm test

echo "==> Starting enclave on :8080 (mock mode)"
SIXFIGS_MOCK_ATTESTATION=1 \
SIXFIGS_DEV_INSECURE_BALANCES=1 \
PORT=8080 \
node --experimental-strip-types src/enclave/server.ts &
ENCLAVE_PID=$!
trap 'kill ${ENCLAVE_PID} 2>/dev/null || true' EXIT

sleep 1
echo "==> GET /hello"
curl -s http://127.0.0.1:8080/hello | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.stringify(JSON.parse(d),null,2)))'

echo
echo "==> Enclave is running. POST an encrypted envelope to /registration."
echo "    (use the browser SDK: RegistrationClient.prepare() then submit())"
wait ${ENCLAVE_PID}