#!/usr/bin/env bash
# Create a dev Confidential Space VM pointed at devnet/testnet chains.
# Requires the dev image from build-image-dev.sh and the same env as
# create-vm.sh, plus SIXFIGS_RPC_SOLANA (a devnet RPC).
#
# Optional: SIXFIGS_RPC_SEPOLIA, SIXFIGS_NULLIFIER_KEY, COINGECKO_API_KEY,
# SIXFIGS_DEV_INSECURE_BALANCES=1 (deterministic large balances for tier tests).
set -euo pipefail

: "${SIXFIGS_RPC_SOLANA:?set SIXFIGS_RPC_SOLANA to a devnet RPC}"
: "${SIXFIGS_VM_PROJECT:?set SIXFIGS_VM_PROJECT}"
: "${SIXFIGS_WORKLOAD_PROJECT:?set SIXFIGS_WORKLOAD_PROJECT}"
: "${SIXFIGS_ARTIFACT_REPOSITORY:?set SIXFIGS_ARTIFACT_REPOSITORY}"
: "${SIXFIGS_VM_ZONE:?set SIXFIGS_VM_ZONE}"
: "${SIXFIGS_SERVICE_ACCOUNT:?set SIXFIGS_SERVICE_ACCOUNT}"

export SIXFIGS_IMAGE_TAG="${SIXFIGS_IMAGE_TAG:-dev}"
export SIXFIGS_VM_NAME="${SIXFIGS_VM_NAME:-sixfigs-enclave-dev}"

ENTRIES="tee-env-SIXFIGS_RPC_SOLANA=${SIXFIGS_RPC_SOLANA}"
ENTRIES+="~tee-env-SIXFIGS_DEV_CHAINS=1"
ENTRIES+="~tee-env-SIXFIGS_ALLOWED_ORIGIN=${SIXFIGS_ALLOWED_ORIGIN:-http://localhost:3000}"
if [[ -n "${SIXFIGS_RPC_SEPOLIA:-}" ]]; then
  ENTRIES+="~tee-env-SIXFIGS_RPC_SEPOLIA=${SIXFIGS_RPC_SEPOLIA}"
fi
if [[ -n "${SIXFIGS_RPC_SOLANA_SECONDARY:-}" ]]; then
  ENTRIES+="~tee-env-SIXFIGS_RPC_SOLANA_SECONDARY=${SIXFIGS_RPC_SOLANA_SECONDARY}"
fi
if [[ -n "${SIXFIGS_RPC_SEPOLIA_SECONDARY:-}" ]]; then
  ENTRIES+="~tee-env-SIXFIGS_RPC_SEPOLIA_SECONDARY=${SIXFIGS_RPC_SEPOLIA_SECONDARY}"
fi
if [[ -n "${SIXFIGS_NULLIFIER_KEY:-}" ]]; then
  ENTRIES+="~tee-env-SIXFIGS_NULLIFIER_KEY=${SIXFIGS_NULLIFIER_KEY}"
fi
if [[ -n "${SIXFIGS_ESCROW_KEY:-}" ]]; then
  ENTRIES+="~tee-env-SIXFIGS_ESCROW_KEY=${SIXFIGS_ESCROW_KEY}"
fi
if [[ -n "${COINGECKO_API_KEY:-}" ]]; then
  ENTRIES+="~tee-env-COINGECKO_API_KEY=${COINGECKO_API_KEY}"
fi
if [[ "${SIXFIGS_DEV_INSECURE_BALANCES:-}" == "1" ]]; then
  ENTRIES+="~tee-env-SIXFIGS_DEV_INSECURE_BALANCES=1"
fi

export SIXFIGS_EXTRA_METADATA="${ENTRIES}"
exec "$(dirname "$0")/create-vm.sh"