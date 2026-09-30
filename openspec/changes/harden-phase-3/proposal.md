# Proposal

## Why

Two hardening passes closed the fail-open paths, keyed the nullifiers, and bounded enclave work. Four audit items remain that need new infrastructure or protocols rather than code fixes: a leaked registry is still matchable by anyone holding the enclave key, prices rest on a single unauthenticated API, a lost wallet bricks an account, and production has no multi-instance or incident story. This change tracks that final hardening.

## What Changes

- Blind OPRF nullifiers: the enclave evaluates nullifiers obliviously so clients learn nothing about the mapping and the server learns nothing about inputs; replaces env-key HMAC as the production scheme.
- Signed price feed: price quotes carry feed signatures verified inside the enclave, replacing blind CoinGecko trust (light-client storage proofs stay an alternative).
- Threshold wallet transitions: N−1-of-N recovery with an explicit takeover-risk model, so a lost wallet no longer bricks an account.
- HA and incident runbook: multi-instance enclave behind a load balancer, key-rotation procedure, registry write-only enforcement checks, and alerting on verification failures.

## Capabilities

### New Capabilities
- `blind-oprf-nullifiers`: oblivious nullifier evaluation replacing keyed HMAC.
- `signed-price-feed`: in-enclave verification of signed price data.
- `threshold-transitions`: loss-tolerant wallet-set transitions with a risk model.
- `ha-runbook`: multi-instance deployment and incident procedures.

### Modified Capabilities
- None. No baseline specs exist yet, so all behavior is captured as new requirements in the change deltas.

## Impact

- `tee/`: new OPRF endpoint and scheme (`nullifierScheme: "oprf-v1"`), pricing provider abstraction, transition policy versioning, deployment scripts and docs.
- Operators must run KMS or equivalent for the OPRF key, subscribe a signed feed, and operate ≥2 enclave instances.
