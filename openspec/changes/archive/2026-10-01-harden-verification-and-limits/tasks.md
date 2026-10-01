# Tasks

> Resume: all code and tests are done. Remaining: final full verification
> run (task 5.2), then `openspec archive harden-verification-and-limits` when
> the proposal's behavior is accepted as shipped.

## 1. Fail-closed PKI verification

- [x] 1.1 `verifyPkiToken` requires a root PEM and enforces leaf/root validity windows (src/verifier/jwt.ts)
- [x] 1.2 Added a unit test proving an empty/absent root throws (test/verifier.test.ts)
- [x] 1.3 `AttestationVerifier.loadPkiRoot` propagates failures; `verifyToken` maps them to `pki_root_unavailable` / `pki_invalid` (src/verifier/index.ts)
- [x] 1.4 Added a test with a crafted x5c token and a stubbed failing fetch asserting `pki_root_unavailable` (test/verifier.test.ts)

## 2. Mandatory allowlists

- [x] 2.1 Exported `checkTokenClaims` rejects empty digest/project lists with `policy_not_configured` (src/verifier/index.ts)
- [x] 2.2 Added direct-call tests: empty lists throw, a configured matching policy passes, a mismatched digest is still `image_not_allowed` (test/verifier.test.ts)
- [x] 2.3 Exported client `assertAttestationClaims` rejects empty/missing lists (src/client/attestation.ts)
- [x] 2.4 Added `test/client.test.ts` covering empty ⇒ throw, configured match ⇒ pass, mock path untouched

## 3. Enclave request controls

- [x] 3.1 `src/enclave/limits.ts` with `FixedWindowRateLimiter` and `ConcurrencyGate`
- [x] 3.2 Added `test/limits.test.ts` proving limit enforcement, window reset with an injected clock, gate capacity, and prune bounding
- [x] 3.3 `MAX_ASSETS_PER_REQUEST=300` caps inside `discoverEvmBalances` and `discoverSolanaBalances` (src/shared/constants.ts, src/enclave/balances.ts, src/enclave/solana.ts)
- [x] 3.4 Threaded `deadline` through `collectBalances` with a shared remaining-asset budget and added the pricing-loop budget check raising `budget_exceeded` (src/enclave/registration.ts)
- [x] 3.5 Added a `budget_exceeded` test using a delayed custom PricingProvider with `SIXFIGS_REGISTRATION_BUDGET_MS=1` (test/registration.test.ts)
- [x] 3.6 Wired the limiter (429) and the gate (503) into `handleRegistration`, mapped `budget_exceeded` to 503, removed the `NODE_ENV=test` mock fallback, and defaulted CORS to absent (src/enclave/server.ts)
- [x] 3.7 Added tests proving `NODE_ENV=test` alone selects the real provider and a saturated gate returns 503 (test/e2e.test.ts)

## 4. Production defaults and supply chain

- [x] 4.1 Defaulted to the `confidential-space` image family (`scripts/create-vm.sh`, `.env.example`); pinned the base digest in `Dockerfile`; switched to `npm ci --ignore-scripts`; added root `.npmrc`; set `package.json` engines to `>=22.6`
- [x] 4.2 Verified by building the image, grepping the pinned digest, and smoke-testing `/healthz` in the built container

## 5. Documentation truth pass

- [x] 5.1 Corrected `docs/SECURITY.md`, `docs/ATTESTATION.md`, `README.md`, and `docs/INTEGRATION.md` overclaims and documented the new limits, verified against the final code
- [x] 5.2 Ran `npm run typecheck && npm test` (61/61 pass) and `openspec validate --strict` (valid)
