# Security model and honest limitations

The product promise is: *your address and balance are never visible to the
platform, and you can verify that claim yourself.* This document states what is
actually protected, what is not, what changed after the identity review, and
what would have to change to strengthen it further.

## Threat model

| Adversary | Goal | Mitigation |
| --- | --- | --- |
| 6figs backend operators | read addresses/balances | Never receive them. Schema has no such columns. Enclave returns nullifiers + tier only. |
| Workload operator (runs the VM) | tamper with the enclave or read memory | Confidential Space: encrypted memory (SEV/TDX), measured OS, launch policies forbid cmd/env/log overrides. |
| GCP itself | read enclave memory | Out of scope of the software; this is the TEE vendor trust assumption. |
| A malicious client | claim a tier it does not hold | Must produce valid EVM/Solana signatures over the exact challenge for every address, and all balances are fetched server-side inside the enclave from the address, not supplied by the client. |
| A network middleman or TLS-terminating proxy | substitute the enclave's keys or results | Google attestation binds the image; the token nonce binds both enclave public keys; the result token binds the signing key and the exact result bytes. |
| An attacker controlling RPC responses | inflate balances | Balance is read inside the enclave over TLS; a lying RPC is a risk — mitigations below. |
| An attacker controlling prices | inflate value | CoinGecko is semi-trusted; dollar-range assets capped at $1.00; overflowing prices rejected; unpriced assets skipped. |
| A dictionary attacker with the registry DB | map a wallet nullifier back to a known address | Open risk; see "confirmable wallet nullifier". Registry must stay private and write-only. |

## What the backend knows

Per user: a random-looking **identity nullifier**, a **tier**, a coarse
**portfolio band** (`<100k`, `100k-300k`, `300k-500k`, `500k-1m`, `1m+`), up to
three **disclosed asset symbols** (`topAssets`, never amounts), and one
**wallet nullifier** per enrolled wallet. No stablecoin share or allocation
percentage is ever sent or stored. Users who choose `hidden` disclosure send no
allocation at all, only tier and symbols. The backend additionally holds an
**escrow blob**: the
wallet set encrypted to the enclave escrow key. It is ciphertext to everyone
but the enclave, which alone decrypts it inside a recheck to refresh the tier
without new signatures.

The identity nullifier is not a credential and not a secret: it is the
commitment of the wallet set —

```
walletNullifier      = SHA-256("6figs-wallet-v1"|family|normalizedAddress)          (legacy-v1)
                     = HMAC(key, "6figs-wallet-v2"|family|normalizedAddress)       (keyed-v1)
identityNullifier    = SHA-256("6figs-identity-v2"|sorted family:walletNullifier list)
```

The wallet set that signatures bind is always the legacy commitment, which the
browser derives without any secret. The stored identity commits to the active
scheme's nullifiers instead; the scheme rides in `/hello` and in the signed
result, and the verifier allowlists it. Production boots refuse to run without
a nullifier key (`SIXFIGS_NULLIFIER_KEY`), so the guarantee cannot silently
degrade to legacy.

## Identity model after the review

An earlier draft derived the account from a client-held `identitySecret`. That
made the platform unable to identify the user, but it also meant losing the
secret lost the account, and there was no recovery channel by construction. The
review replaced it:

- **The account is the wallet set.** No secret exists. Re-signing with the same
  wallets produces the same identity — recovery is automatic.
- **Growing is add-only and email-authorized.** Adding a wallet produces a new
  identity. The added wallet signs a compact consent bound to the account's
  identity pseudonym, and the backend accepts the transition only when it can
  prove against its stored bindings that the new set is a strict superset
  (previous identity matches the session user, stored wallets all present, and
  the claimed added wallets are exactly the new ones). Old wallets are not
  asked to sign; the email session plus control of the added wallet is the
  authority. The enclave recomputes the previous identity from the stored
  escrow blob, so a forged base identity fails before any signing.
- **Removal is not a product path.** The enclave can still build a removal
  result for protocol compatibility, but the backend rejects any result that
  carries removed wallets, so no membership can shrink. A wallet binding is
  never deleted by the product flow.
- **Losing a wallet is currently unrecoverable.** Recovering with N−1 of N
  wallets needs a threshold policy (and its own risk model); it is deliberately
  not implemented yet.
- **One wallet, one account.** Wallet nullifiers are unique-indexed; a set
  spanning two existing identities is rejected.

Costs of this model, stated plainly: account security is the email account plus
the enrolled wallets. Whoever holds the email session and control of one new
wallet can extend the account (that is what makes additions one-signature);
whoever holds the wallets can re-prove the full set. The trade was a deliberate
product decision: requiring every old wallet to sign made additions impossible
when one was lost and painful otherwise. Email verification, login throttling,
and password rotation are the compensating controls; establishment still
requires every wallet.

## Attack vectors reviewed, and their disposition

| # | Vector | Status | Resolution |
| --- | --- | --- | --- |
| 1 | TLS-terminating proxy rewrites `/hello` and swaps `encryptionPublicKey`; browser encrypts secrets to the attacker | **Fixed** | Attestation nonce is now `SHA-256(signingPub || encryptionPub)`. Client and verifier recompute it and reject a hello whose encryption key is not covered. |
| 2 | Attacker relays a genuine token with their own signing key | Fixed | Token nonce includes the key hash; key substitution fails the equation. |
| 3 | Attacker staples a valid hello token to a doctored registration result | Fixed | The result token is freshly issued with nonce `SHA-256(signingPub || DOMAIN.nonce || SHA-256(DOMAIN.enclaveResult || canonicalBody))`. |
| 4 | Forged or debug enclave | Fixed | Google JWKS/PKI signature, `image_digest` allowlist, project/zone allowlist, `dbgstat != enabled`, token expiry. |
| 5 | Replaying a wallet signature for another account or later request | Fixed | Challenge contains identity + timestamp + nonce; enclave enforces a ±120 s window. |
| 6 | Client submits fake balances | Fixed | The client never sends balances; the enclave fetches them from the verified address. |
| 7 | Replaying a signed result to the backend | Partially mitigated | Result TTL and idempotent persistence bound to the identity. The request-nonce check only binds when the caller passes the *original* client nonce; the NestJS example passes the body's own nonce, which cannot detect replay. |
| 8 | Dictionary attack: compute the nullifier for public whale addresses and match stored nullifiers | **Partially mitigated** | Keyed nullifiers need the enclave key, so a leaked registry resists offline matching. Legacy rows remain confirmable; rotate to `keyed-v1` and retire them. Keep registration write-only and authenticated regardless. A blind OPRF is the planned upgrade (below). |
| 9 | Losing the identity secret | **Eliminated** | Secret removed; wallet set is the account. |
| 10 | Backend-issued IDs / JWTs as the root of identity | Rejected | They make the backend the credential authority and leave it holding a replayable bearer token. Nothing signed or hashed is delegated to the backend. |
| 11 | Partial wallet compromise adds or removes wallets | Accepted for additions, rejected for removals | Additions need only the added wallet's signature plus the authenticated session, by product design; the backend still requires a strict superset transition and the enclave re-derives the base identity from the escrow blob. Removals are rejected outright. |
| 12 | Merging two accounts' wallets | Rejected | Set spanning two owners is a conflict; DB unique constraint is the backstop. |
| 13 | A wallet is enrolled by two identities | Rejected | `wallet_nullifier` primary key + `bindWallets` conflict check. |
| 14 | Unknown token-inflation (airdrop a fake token, hope it is valued) | Mitigated | No allowlist, but every asset needs a real price API quote, prices are overflow-checked, and dollar-range assets are capped. Residual risk needs liquidity/volume gates or a signed price feed. |
| 15 | RPC provider correlates the enclave's egress IP with queried addresses | Open | Rotate RPC providers, decoy queries, or run a self-hosted light client/validator. Listed below. |
| 16 | RPC lies about a balance | Partially mitigated | RPC endpoints must be HTTPS. When a secondary RPC is configured, value-critical reads must agree within 0.1% or the registration fails (`rpc_disagreement`). Single-provider deployments keep the documented risk. Storage proofs against a light client remain the stronger option. |
| 17 | Backend treats `identityNullifier` as an auth token | Operational rule | Authorization must come from signed/attested material or a backend-issued session established after verification. The nullifier is a pseudonym, not a password. |
| 18 | Timing / metadata correlation of registrations | Accepted | The wallet set is a stable pseudonym by design; there is no per-epoch rotation to hide behind. |
| 19 | Envelope replay within the freshness window | Mitigated | The enclave caches processed nonces and rejects replays (`replay_detected`), checked after the concurrency gate so overload refusals never burn a nonce. |
| 20 | Internal error text in 500 responses | Fixed | Unexpected failures return a fixed generic message; client-caused errors keep their codes. |

## Known leaks and mitigations

**1. RPC provider sees addresses.** The enclave queries Alchemy/Infura/Helius,
so those providers can correlate the enclave's egress IP with the queried
addresses. Mitigations, in rough order of effort:

- Rotate across multiple RPC providers per request.
- Add decoy queries for unrelated addresses (impl-2 used a 5:1 decoy ratio).
- Run a self-hosted light client (Helios) for state reads and a self-hosted
  Solana node, eliminating the third-party RPC entirely.
- Egress through distinct IPs per provider.

**2. Confirmable wallet nullifier.** The deployed fix is keyed derivation:
with `SIXFIGS_NULLIFIER_KEY` provisioned, nullifiers are
`HMAC(key, "6figs-wallet-v2"|family|address)`, so a leaked registry resists
offline matching without the key. Remaining gaps: the key lives in the
enclave's environment rather than KMS, and legacy rows stay confirmable until
retired. The stronger fix is a blind OPRF: the enclave holds a KMS key and
evaluates it obliviously, so the client cannot learn the input-output mapping.
Until either lands, treat the registry as write-only from the outside.

**3. Price-source manipulation.** CoinGecko could be wrong or manipulated.
Defenses: no guessed values (unpriced assets are skipped), overflowing prices
rejected, dollar-range assets capped at $1.00, and the total is bucketed so
small price errors rarely cross a tier boundary. A signed price feed
(Pyth/Chainlink via an on-chain verifier) is the stronger option and can be
added without changing the client protocol.

**4. RPC lying about balances.** A compromised RPC could overstate a balance.
Defenses: RPC URLs must be HTTPS; configure a secondary RPC per chain and the
enclave requires agreement within 0.1% on value-critical reads
(`rpc_disagreement` on mismatch, chain skipped when the secondary is down).
Storage proofs inside the enclave against a beacon-chain light client remain
the stronger option (cheap off-circuit, since this is now ordinary code).

**5. Timing / metadata.** Request timing and tier assignment are visible to the
backend. Identity is the wallet set, so it is stable across re-registrations by
design; if unlinkability across visits is wanted, that is a separate credential
layer, not something the nullifier can provide.

## Token valuation after removing the allowlist

The curated `TOKEN_SEEDS` list was deleted. Consequences and replacement rules:

- **Discovery is enumeration, not listing.** Solana uses
  `getTokenAccountsByOwner` (all token accounts). EVM prefers the provider's
  `alchemy_getTokenBalances` enumeration (all historical holdings) and falls
  back to a Transfer-log scan window when the method is unavailable; the
  fallback window is a known coverage limit.
- **Valuation is price-or-skip.** Every discovered holding is quoted by
  contract address. No price → the position is skipped, never guessed.
- **Par rule.** Assets quoted within ±$0.01 of $1.00 are counted at exactly
  $1.00 and classified `stable`, replacing the per-token stable flag.
- **Category rule.** `stable` = par band, `majors` = price ≥ $50, everything
  else `altcoins`. Categories are a disclosure feature, not a safety gate.
- **Tradeoff.** An unknown asset that CoinGecko prices correctly is now counted
  at full value, and a real listing is the only quality gate. Spam tokens with
  real prices are a residual risk (vector 14).

## Improvements adopted in this revision

- `/hello` attestation nonce binds both enclave public keys; a substituted
  encryption key is rejected by client and verifier.
- `identitySecret` removed. `identityNullifier` is the commitment of the signed
  wallet set, recomputed independently by the verifier.
- Recovery is the wallet set itself; additions are add-only and need only the
  added wallet's signature over a compact challenge that binds the account
  pseudonym and the wallet; the backend enforces superset semantics against its
  stored bindings and rejects removals. One-wallet-one-account requires the
  production store to run each submission in one transaction (the reference
  in-memory store does not); without that, concurrent transitions of one
  account can interleave.
- Token allowlist removed. Solana enumerates all token accounts; EVM prefers
  provider token-balance enumeration with a Transfer-log fallback; every
  discovered holding is priced or skipped; par-band cap replaces the seeded
  stablecoin flag.
- Attestation verification fails closed (`openspec/changes/harden-verification-and-limits/`):
  PKI root mandatory with validity windows, image/project allowlists mandatory,
  enclave rate limit (429) / concurrency gate (503) / 300-asset cap / 30 s budget
  (`budget_exceeded`), production image family and digest-pinned base by default.
- Phase-2 hardening (`openspec/changes/harden-phase-2/`): keyed nullifiers with
  production fail-closed provisioning; HTTPS-only RPC with optional dual-provider
  agreement; transactional registration persistence; membership-visible ownership
  challenges; pinned/cached/time-bounded browser JWKS; code-only facade logging;
  replay rejection, generic 500s, paginated enumeration; restart-on-failure VMs.
- New tests: identity/set commitment, hello key substitution, add-wallet
  transition, shrink refusal, cross-account merge refusal, end-to-end
  registration and recovery.

## Improvements planned

- KMS-backed OPRF nullifiers, closing the dictionary-attack gap.
- KMS-bound escrow key SHIPPED: the enclave unwraps the escrow key through
  Cloud KMS using the Confidential Space token, workload identity federation,
  and optional service-account impersonation. Production refuses the
  `SIXFIGS_ESCROW_KEY` environment path unless
  `SIXFIGS_ALLOW_ENV_ESCROW_KEY=1`, so the "only the enclave can decrypt"
  claim is enforced by the KMS IAM policy rather than by the environment.
- Signed price feed and dual-provider balance reads (or storage proofs).
- Threshold transition policy so a user who loses one of N wallets can recover
  with N−1 signatures, with a proportional takeover-risk model.
- Self-hosted light client / Solana node to remove third-party RPCs.

## What a TEE does not give you

- It does not remove the vendor from the trust base. Google can, in principle,
  be compelled. Attestation makes behavior *checkable*, not impossible to subvert.
- It does not make the enclave code trustless the way a verifier contract is.
  Trust shifts from "trust the math" to "trust this measured image and this
  set of claims." That is why the image digest is pinned in policy and the source
  is public.
- Debug images give the operator root. They are only for staging, and the
  verifier rejects them unless explicitly told otherwise.

## Operational rules

- Never log request bodies. The log redirect launch policy is set to `never`.
- Never run the enclave outside Confidential Space with real data.
- Never enable `allowMock` outside local development.
- Rotate the image digest allowlist deliberately, with review, since that value
  is precisely the code users are trusting.
- Never expose an endpoint that answers "is wallet X registered?" and never
  publish the nullifier set.
- Never accept `identityNullifier` as proof of identity; it is a pseudonym.
- A wallet-set transition must run inside `runTransaction`, must re-check that
  every stored wallet is present in the new set, and must reject any result
  carrying removed wallets. Additions must additionally check that the claimed
  added set is exactly new minus stored and that the base identity belongs to
  the session user.
- Run at least two enclave VMs behind a load balancer with restart-on-failure;
  no affinity is required (ephemeral keys, no local state).