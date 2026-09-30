# 6figs — TEE portfolio verification

Wallet-verified net-worth tiers for `6figs.xyz`, without the platform ever
learning an address or a balance. This folder is the registration/verification
core: a **Google Cloud Confidential Space** workload that fetches balances and
prices, computes a tier, and signs an attestation; a verifier the NestJS backend
calls; and a browser SDK for the Next.js frontend.

This replaces the earlier ZK-circuit approaches, which could not scale past
Ethereum because proving MPT inclusion for one balance costs millions of
constraints. Inside a TEE, balance and price fetching are ordinary code, so
coverage is all tokens on all supported chains, and the chain of trust is an
attestable container image rather than a circuit.

## Why a TEE here

The hard requirement is: **the server must never see addresses or balances, and
users should not have to trust us at our word.** A Confidential Space VM runs
our container on hardware-isolated (AMD SEV / Intel TDX) memory inside a
measured, hardened OS. The workload publishes an attestation token that binds:

- the exact container **image digest** (the auditable code hash),
- the Confidential Space image version and support attributes,
- the GCP project and zone,
- that the image is production (`dbgstat = disabled-since-boot`),
- and a nonce tying the token to a specific key and result.

`tee/` is public: anyone can read the code and reproduce the digest. The backend
and the browser independently verify that token against Google's JWKS before
trusting anything the enclave says.

See [`docs/ATTESTATION.md`](docs/ATTESTATION.md) for the exact flow.

## Architecture at a glance

```
Browser (Next.js)                Confidential Space VM (GCP)           Backend (NestJS)
─────────────────                ────────────────────────────          ────────────────
wallet signs ownership msg
        │                                   │                                  │
        │  1. GET /hello ─────────────────► │                                  │
        │  2. verify attestation token      │                                  │
        │     (WebCrypto vs Google JWKS)    │                                  │
        │                                   │                                  │
        │  3. encrypt envelope (X25519      │                                  │
        │     ECDH + AES-256-GCM) ────────► │                                  │
        │                                   │ decrypt, verify EVM/Solana sigs  │
        │                                   │ fetch balances (EVM RPC/Solana)  │
        │                                   │ fetch prices (CoinGecko)         │
        │                                   │ aggregate → tier + allocation    │
        │                                   │ derive nullifiers                │
        │                                   │ sign result (Ed25519)            │
        │  4. signed result + token ◄────── │                                  │
        │  5. verify signature + token      │                                  │
        │                                   │                                  │
        │  6. POST signed result ───────────────────────────────────────────► │
        │                                   │        7. verify attestation +   │
        │                                   │           signature + policy,    │
        │                                   │           store nullifiers/tier  │
```

What the backend stores: an **identity nullifier**, a **tier**, a coarse
portfolio band, a stablecoin allocation, and **wallet nullifiers**. No
addresses, no balances, no exact totals.

## Layout

| Path | What it is |
| --- | --- |
| `src/shared/` | Protocol types, constants, canonical JSON, crypto, envelope, tier math. |
| `src/enclave/` | The workload: attestation provider, key manager, ownership checks, balance discovery (EVM + Solana), pricing, registration, HTTP server. |
| `src/verifier/` | Backend-side attestation verification, policy checks, nullifier store, NestJS facade. |
| `src/client/` | Browser SDK: attestation verification, request encryption, two-phase registration. |
| `db/schema.sql` | Storage schema. Contains no address/balance columns by construction. |
| `scripts/` | Build/push image, create the VM, run locally. |
| `test/` | Node test-runner suite covering crypto, tier math, ownership, verification, and an HTTP end-to-end flow. |
| `docs/` | Architecture, attestation, integration, security/limitations. |

## Quick start (local, no GCP)

```bash
cd tee
npm install
npm test
SIXFIGS_MOCK_ATTESTATION=1 SIXFIGS_DEV_INSECURE_BALANCES=1 npm run server
```

The mock mode issues structurally-identical attestation tokens and returns
deterministic balances, so the whole pipeline (including the browser-side
attestation check) is exercised without GCP or RPC keys. The verifier refuses
mock tokens unless `allowMock: true` is set explicitly.

## Deploying to Confidential Space

```bash
cp .env.example .env      # fill in RPC URLs, project ids, etc.
set -a; source .env; set +a

./scripts/build-image.sh  # prints the pinned image digest
./scripts/create-vm.sh    # creates the Confidential Space VM
```

Then pass the printed digest to the backend policy and the web client:
`allowedImageDigests: [process.env.SIXFIGS_IMAGE_DIGEST]`. Pin digests, not tags.

## The privacy tradeoffs, stated plainly

- **RPC providers see the queried addresses.** The enclave calls public RPCs
  (Alchemy, Infura, Helius). That is the accepted cost of not running an
  indexer. Rotating providers and querying from the enclave's egress IP limits
  linkage, but it is a real leak. `docs/SECURITY.md` covers mitigations.
- **CoinGecko is a semi-trusted price source.** There is no token allowlist:
  every discovered holding is quoted and unpriceable assets are skipped, never
  guessed. Assets within ±$0.01 of $1.00 are capped at $1.00 and classified
  stable. At most 300 assets are valued per registration (excess ignored), and
  registrations time out after 30 s rather than returning partial valuations.
- **A deterministic wallet nullifier is one-way but confirmable.** Given a
  candidate address you can recompute its nullifier and test membership. Closing
  that needs a KMS-OPRF; see `docs/SECURITY.md`.
- **Google is in the trust base**, as with any TEE. The attestation makes its
  behavior checkable, and the code is public.

## Status

Verification core complete and tested. Rooms, chat, and the tic-tac-toe
icebreaker live in the backend and consume the `tier` this service produces;
they are out of scope for this folder.