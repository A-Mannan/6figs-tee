# Tasks

> Resume here: all planning artifacts are written and validated. Implement in
> group order; check a box only when the code and its stated verification both
> pass.

## 1. Keyed nullifiers

- [x] 1.1 Add the `NullifierScheme` abstraction with legacy and keyed (HMAC) schemes plus a `6figs-wallet-v2` domain tag (src/shared/nullifiers.ts)
- [x] 1.2 Advertise the scheme in `/hello`, commit it into the signed body, and gate it in the verifier with a mandatory `allowedNullifierSchemes` list; verify by unit tests for both schemes and the gate
- [x] 1.3 Select the scheme in the server from `SIXFIGS_NULLIFIER_KEY`, failing closed in production without it; verify by a boot test and a keyed end-to-end registration whose identity differs from the legacy one
- [x] 1.4 Thread the scheme through the client (`prepare` scheme argument) and document provisioning plus the migration plan; verify by `npm test` and docs review

## 2. Trusted data sources

- [x] 2.1 Reject non-HTTPS RPC URLs in endpoint resolution; verify by a test with an `http://` URL asserting the chain is skipped
- [x] 2.2 Add optional secondary-RPC agreement (0.1% tolerance, `rpc_disagreement` on mismatch) for native and token balance reads; verify by stubbed-fetch agreement/disagreement tests

## 3. Transactional registration

- [x] 3.1 Add `runTransaction` to the store interface with a mutex-backed in-memory implementation; move the service decision flow inside it; verify existing service tests still pass
- [x] 3.2 Add a concurrency test proving two overlapping transitions serialize to one coherent state
- [x] 3.3 Rewrite the Postgres guidance around a single locked transaction; verify by docs review

## 4. Membership-visible challenges

- [x] 4.1 Include the sorted wallet set in `ownershipChallenge`, bump `POLICY_VERSION` to `-d`, and update all callers; verify by tests asserting the message lists the addresses
- [x] 4.2 Verify by `npm run typecheck` plus the updated registration and end-to-end suites

## 5. Browser client JWKS handling

- [x] 5.1 Add pinned-JWKS support, a 1 h JWKS cache, and a 10 s fetch timeout to the client verifier; verify by tests proving offline pinned verification, single-fetch caching, and prompt timeout failure

## 6. Observability

- [x] 6.1 Wire the NestJS facade logger to record verification outcomes by code only; verify by a fake-logger test asserting one warning per rejection with no identifying data

## 7. Request integrity

- [x] 7.1 Add an enclave-side nonce replay cache (checked after the concurrency gate) returning `replay_detected`; verify by double-submit test and an honest-503-retry test
- [x] 7.2 Return a fixed message for unexpected 500s; verify by a throwing-pricing test asserting no internal text leaks
- [x] 7.3 Follow provider `pageKey` pagination (bounded) in token enumeration; verify by a stubbed two-page discovery test

## 8. Hygiene, availability, and docs

- [x] 8.1 Delete confirmed-dead exports, fix stale comments, and set the VM restart policy to `Always`; verify by `npm run typecheck`, grep, and script review
- [x] 8.2 Update `docs/SECURITY.md`, `docs/INTEGRATION.md`, and `AGENTS.md` for every behavior above; verify by docs review
- [x] 8.3 Ran `npm run typecheck && npm test` (82/82 pass, twice) and `openspec validate harden-phase-2 --strict` (valid)
