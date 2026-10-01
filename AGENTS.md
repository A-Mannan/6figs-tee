# AGENTS.md — 6figs TEE verification

Project guide for this folder. This is `tee/`, the registration and
verification core of 6figs. It is not the NestJS backend or the Next.js
frontend; it is the library and workload they call.

## What this project is

6figs is a private, wallet-verified network for people holding six-figure-plus
crypto positions. A user connects a wallet and receives a proof of a net-worth
tier. Nobody — not even the platform — sees the address or the balance.

`tee/` implements that claim with a Google Cloud **Confidential Space** trusted
execution environment:

- A container workload fetches balances from public RPCs and prices from
  CoinGecko, aggregates the portfolio, assigns a tier, derives nullifiers, and
  signs the result.
- The backend verifies the attestation and the signature, then stores only an
  identity nullifier, a tier, a coarse band, and opaquestable wallet nullifiers.
- The browser verifies the enclave's attestation before sending anything and
  re-verifies the signed result before accepting it.

## Why a TEE and not a ZK circuit

Three earlier implementations proved balances with circuits (MPT inclusion,
Noir, SP1). They all hit the same wall: proving one balance's MPT path in a
circuit costs millions of constraints, was impractical to run in the browser,
and was effectively Ethereum-only.

Inside a TEE, balance fetching and pricing are ordinary code. Coverage becomes
every token on every supported chain. The trust anchor moves from a circuit to a
measured, reproducible container image whose digest is public and pinned in
policy. The tradeoff is that the TEE vendor (Google) enters the trust base; the
attestation makes its behavior checkable rather than unnecessary.

## The flow

```
Browser                         Enclave (Confidential Space VM)        Backend
───────                         ──────────────────────────────         ───────
wallet signs ownership msg
GET /hello ──────────────────►  returns keys + key attestation
verify attestation token        (binds both enclave public keys)
encrypt envelope (X25519 +
  AES-256-GCM) ──────────────►  decrypt
                                verify EVM/Solana signatures
                                fetch balances + prices
                                tier, allocation, nullifiers
                                sign Ed25519 result
signed result + token ◄───────  fresh token nonce binds (key, result)
verify signature + token
POST signed result ──────────────────────────────────────────────────► verify
                                                                        attestation
                                                                        + policy
                                                                        + nullifiers
```

Read `docs/ATTESTATION.md` for the exact nonce and claim mechanics.

## Directory map

| Path | Owns |
| --- | --- |
| `src/shared/` | Protocol contract: types, constants, canonical JSON, hashing, ECIES envelope, Ed25519 signing, base58, tier/valuation math. Imported by every other layer, so changes here are protocol changes. |
| `src/enclave/` | The workload. Attestation provider (launcher socket + mock), key manager, ownership verification, EVM/Solana balance discovery, CoinGecko pricing, registration orchestration, HTTP server. |
| `src/verifier/` | Backend trust boundary. JWT validation (OIDC JWKS / PKI x5c), claim and image policy, signature + nonce checks, nullifier store, NestJS facade. |
| `src/client/` | Browser SDK. Attestation verification via WebCrypto, request encryption, two-phase registration. |
| `db/schema.sql` | Storage schema. By construction it has no address, balance, or amount columns. |
| `test/` | Node test-runner suite: crypto, tier math, ownership, verifier policy, HTTP end-to-end. |
| `scripts/` | `build-image.sh`, `create-vm.sh`, `run-local.sh`. |
| `docs/` | `ATTESTATION.md`, `INTEGRATION.md`, `SECURITY.md`. |

## Privacy invariants (do not break)

- The backend may store an identity nullifier, a tier, `portfolioBand`,
  `stableBps`, wallet nullifiers, the disclosed `topAssets` symbols, and the
  escrow blob (ciphertext only the enclave can decrypt). Nothing else.
- Never add a column, DTO field, or log line that can carry a plaintext or
  base64url address, a balance, a token amount, or an exact total. The escrow
  blob is the only address-bearing value that may rest outside the enclave,
  and it is opaque to everyone but the enclave.
- The stablecoin share (`stableBps`) and up to three `topAssets` symbols are
  intentionally disclosed. Amounts never are. Everything else about the
  portfolio is gated by the request's `disclosure` mode: `hidden` sends no
  allocation, `category` sends bucketed bps, `full` may carry more.
- Nullifiers are one-way. `walletNullifier = SHA-256("6figs-wallet-v1"|family|address)`
  (`legacy-v1`), or `HMAC(key, "6figs-wallet-v2"|family|address)` when
  `SIXFIGS_NULLIFIER_KEY` is provisioned (`keyed-v1`, required in production);
  `identityNullifier = SHA-256("6figs-identity-v2"|sorted wallet nullifiers)`.
  The scheme rides in `/hello` and the signed body and is allowlisted by the
  verifier. Ownership challenges bind the legacy set commitment and list every
  wallet, so the client needs no secret to sign.
  There is no client-held identity secret: the account *is* the wallet set, and
  recovery is re-signing with the same wallets.
- Every wallet enrolled in an account must sign any membership change. Growth:
  all existing wallets re-sign the new set. Removal: kept wallets sign the new
  set and removed wallets sign a removal consent bound to the new set. The
  backend infers the previous account from stored bindings, never from a client
  claim. Silent growth or shrinkage is rejected by the verifier service.
- Verification fails closed. Any failed check throws; nothing is "accepted with
  a warning."

## Protocol constants

- Tiers: `$100k+`, `$300k+`, `$500k+`, `$1M+` (plus `none`). Lower-bound
  assignment. Defined in `src/shared/constants.ts`.
- `POLICY_VERSION` is committed into every signed result and checked by the
  verifier. Bump it when the protocol changes.
- Domain tags live in `DOMAIN` in `src/shared/constants.ts`.
- Chains: EVM — Ethereum, Base, Arbitrum, Optimism, Polygon (native + ERC-20s);
  Solana — SOL + SPL tokens.
- There is no token allowlist. Every discovered holding is quoted; assets the
  price API cannot quote are skipped, not guessed. Assets within the par band
  (±$0.01) are capped at $1.00 and classified `stable`.
- Value math is integer micro-USD (`1e-6`) with explicit overflow guards in
  `src/shared/tier.ts`. Never use floats for money.

## Commands

```bash
npm install
npm test                 # node --test with native type stripping
npm run typecheck        # tsc --noEmit
npm run server           # real attestation mode (needs a Confidential Space VM)
SIXFIGS_MOCK_ATTESTATION=1 SIXFIGS_DEV_INSECURE_BALANCES=1 npm run server
./scripts/run-local.sh   # install, test, boot mock enclave
./scripts/build-image.sh # build + push, prints the digest to pin
./scripts/create-vm.sh   # create the Confidential Space VM
```

There is no build step. Node runs the TypeScript directly via type stripping;
the shipped source is the reviewed source.

## Engineering conventions

- **Node ≥ 20, native type stripping.** Imports must use explicit `.ts`
  extensions. Do **not** use constructor parameter properties, enums, or
  namespaces — Node's stripper rejects them. Declare and assign fields
  explicitly (this is why several classes look slightly verbose).
- **Dependencies are deliberately minimal**: `@noble/curves` and
  `@noble/hashes` only, plus WebCrypto (`globalThis.crypto.subtle`) for AES-GCM
  and browser JWT verification. Do not add `ethers`, `viem`, `@solana/web3.js`,
  or similar to the enclave; raw JSON-RPC through `src/enclave/rpc.ts` is the
  pattern.
- **Anything signed or hashed goes through `canonicalJson`.** Never concatenate
  fields by hand and never rely on `JSON.stringify` key order.
- **WebCrypto inputs** go through `asBufferSource` in `src/shared/crypto.ts`
  to satisfy the `BufferSource` typings.
- **No request-body logging, ever.** The Dockerfile sets the log-redirect
  launch policy to `never`; keep it that way and keep `console` out of the
  request path.
- **Mock attestation is dev-only.** It is accepted only when
  `SIXFIGS_MOCK_ATTESTATION=1` on the enclave and `allowMock: true` on the
  verifier/client. Never enable it in production paths.
- **Pin digests, not tags.** The image digest is the code users trust; it goes
  into `allowedImageDigests` in the verifier policy and the client policy.
- **No comments that narrate the obvious.** Comments here explain protocol
  mechanics and trust decisions, not what a line of code does.

## Status and scope

Verification core is complete and covered by tests. Rooms, 1:1 chat, and the
tic-tac-toe icebreaker live in the separate backend and consume the `tier` this
service produces. On-chain verification, KMS-backed OPRF nullifiers, and a
signed price feed are the planned hardening steps, described in
`docs/SECURITY.md`.

## Spec-driven workflow (OpenSpec)

This repo uses OpenSpec (skills in `.agents/skills/openspec-*`, root at
`openspec/`). Rules for any agent, including a fresh session picking up work:

- `openspec/specs/` is current-truth behavior contracts (`#### Scenario` with
  WHEN/THEN). Never edit them directly to describe new behavior.
- New behavior lands as a change in `openspec/changes/<kebab-name>/` with
  `proposal.md`, `design.md`, `specs/<capability>/spec.md` deltas, and
  `tasks.md`. `tasks.md` is the resume point; its top note names the next
  physical step.
- Mark a task `- [x]` only when implemented **and** verified by the test or
  command stated in that task.
- After creating or editing change artifacts, run
  `npx -y @fission-ai/openspec@1.13.2 validate <change>` from this folder and
  fix any errors before continuing.
- Project conventions for generated artifacts live in
  `openspec/config.yaml` under `context`.

## Active work

- `openspec/changes/integration-product/` — wiring tee into the Next.js frontend
  and NestJS backend. Current scope: four-tier identity mapping, `topAssets`
  disclosure, email accounts, encrypted address escrow with hourly recheck,
  and a tier + top-3 profile. Phase 0 packaging/nonce work is done; protocol
  additions, backend branch, and frontend branch remain. Resume at its
  `tasks.md`; read `## Blockers` first (dev gates resolved; production gates
  are KMS-bound escrow key and a mailer). App work goes on feature branches
  only, never `main` of either app repo.
- `openspec/changes/harden-phase-3/` — leftover audit hardening (blind OPRF,
  signed price feed, threshold transitions, HA runbook). All tasks pending;
  do not start until integration Phase 0 ships. Its `## Blockers` lists the
  KMS, feed-vendor, review, and infra dependencies.
- Archived: `harden-verification-and-limits` and `harden-phase-2` (both 19/19,
  82/82 tests) moved to `openspec/changes/archive/` on 2026-10-01; their
  deltas are now the baseline in `openspec/specs/`. Changes whose deltas say
  ADDED against these capabilities must use MODIFIED/ADDED against the specs.