#!/usr/bin/env bash
# Build the dev enclave image. DEV ONLY: relaxes the env-override launch policy
# so the VM can be configured with tee-env-* metadata (devnet RPCs, dev
# nullifier key). Never pin this digest in production policy.
set -euo pipefail

export SIXFIGS_IMAGE_TAG="${SIXFIGS_IMAGE_TAG:-dev}"
export SIXFIGS_ALLOW_ENV_OVERRIDE="${SIXFIGS_ALLOW_ENV_OVERRIDE:-SIXFIGS_RPC_SOLANA,SIXFIGS_RPC_SOLANA_SECONDARY,SIXFIGS_RPC_SEPOLIA,SIXFIGS_RPC_SEPOLIA_SECONDARY,SIXFIGS_DEV_CHAINS,SIXFIGS_DEV_INSECURE_BALANCES,SIXFIGS_NULLIFIER_KEY,SIXFIGS_ESCROW_KEY,SIXFIGS_ALLOWED_ORIGIN,COINGECKO_API_KEY,SIXFIGS_PRICE_TTL_MS}"

exec "$(dirname "$0")/build-image.sh"