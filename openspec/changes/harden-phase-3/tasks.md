# Tasks

> Resume here: everything below is pending future work. Do not start until the
> integration-product Phase 0 ships, since several items depend on its packaging.
> Read `## Blockers` before starting: every group below waits on something
> outside this repo.

## Blockers

- [ ] B1 Infrastructure — no KMS or equivalent exists. Blind OPRF needs a key-management home first; the keyed-HMAC scheme stays production until then. The same KMS gates the production escrow key required by integration-product (only the attested image may decrypt addresses).
- [ ] B2 Vendor/product — no signed feed provider chosen (Chainlink vs Pyth) and no subscription; without it the feed work cannot start.
- [ ] B3 Review — the threshold-transition risk model needs explicit product + security sign-off (task 3.1); implementation waits on it.
- [ ] B4 Infrastructure — single VM today. HA needs a second instance plus load-balancer config owned by the enclave operator.
- [ ] B5 Sequencing — do not start this change until integration-product Phase 0 ships.

## 1. Blind OPRF nullifiers

- [ ] 1.1 Design the blinded evaluation endpoint (request/response shapes, KMS key reference, `oprf-v1` scheme name); verify by design review against the dictionary-attack scenario
- [ ] 1.2 Implement enclave-side evaluation plus client blinding/unblinding; verify by a test proving operator-side recomputation fails while honest registration succeeds
- [ ] 1.3 Migrate `allowedNullifierSchemes` policy and document key rotation/retirement; verify by docs review

## 2. Signed price feed

- [ ] 2.1 Add a feed-signature verification path in pricing with a bounded staleness policy (`price_stale` outcome); verify by tests with valid, stale, and forged quotes
- [ ] 2.2 Remove unsigned CoinGecko as a silent fallback; verify by a test asserting unsigned quotes are skipped, never valued

## 3. Threshold transitions

- [ ] 3.1 Specify the N−1 cooldown + contest protocol and its takeover-risk model; verify by product and security review sign-off
- [ ] 3.2 Implement pending-transition state, cooldown enforcement, and contest cancellation; verify by tests for uncontested recovery, contested cancellation, and cooldown-bypass with all wallets

## 4. HA and incident response

- [ ] 4.1 Stand up a second enclave behind the load balancer with no affinity; verify by killing one instance mid-suite and confirming registrations continue
- [ ] 4.2 Add verification-failure alerting and a registry write-only audit; verify by a simulated spike paging with code-only breakdowns
