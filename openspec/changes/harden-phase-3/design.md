# Design

## Context

Baseline: keyed HMAC nullifiers need the env key (readable by anyone with the enclave environment); CoinGecko is the sole price source; every enrolled wallet must sign every transition, so one lost wallet bricks the account; one VM with restart-on-failure is the whole fleet. See proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- A registry leak reveals nothing matchable, even to key holders.
- A manipulated price cannot silently inflate a tier.
- Losing one wallet degrades rather than destroys an account.
- Production survives a single VM loss without manual steps.

**Non-Goals:**
- Changing the wallet-set identity model or the challenge format again (threshold transitions reuse them).
- Removing the keyed-HMAC scheme before OPRF ships (it stays as fallback).

## Decisions

- **OPRF before KMS-HMAC.** A KMS-held HMAC still lets the operator evaluate arbitrary addresses; blindness is the property that closes the dictionary attack. The OPRF key lives in KMS, evaluation happens inside the enclave.
- **Feed signatures over feed redundancy.** Verifying one signed feed beats averaging N unsigned APIs; Chainlink/Pyth payloads verify with secp256k1/ed25519 already in the dependency set.
- **Explicit risk model for thresholds.** N−1 recovery means N−1 stolen wallets take the account; the model states this plainly and gates the feature behind a per-account opt-in with a cooldown.
- **Stateless scale-out.** Enclave instances share nothing; the nullifier store stays the serialization point, so adding instances needs no protocol change.

## Risks / Trade-offs

- [OPRF adds a round trip to registration] → Mitigation: batch blinded evaluations per wallet set.
- [Feed outage blocks proofs] → Mitigation: bounded staleness policy with explicit `price_stale` errors, never silent fallback to unsigned prices.
- [Threshold recovery weakens the all-sign invariant] → Mitigation: cooldown + cooldown-bypass requires all wallets; documented in the risk model.
