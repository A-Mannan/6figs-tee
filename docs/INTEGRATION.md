# Integrating with the Next.js frontend and NestJS backend

## Dependency

Both apps consume this repo as a versioned git dependency — never a relative
path, so both sides always build against the same reviewed code:

```json
{ "dependencies": { "@sixfigs/tee": "github:A-Mannan/6figs-tee#<tag-sha>" } }
```

```ts
import { RegistrationClient } from "@sixfigs/tee/client";
import { SixFigsVerification } from "@sixfigs/tee/verifier";
import { productTierLabel } from "@sixfigs/tee/shared";
```

Only these three subpaths are public; deep imports are blocked by the
`exports` map. Releasing a consumable tag from this repo:

```bash
npm run build   # emits dist/ (client, verifier, shared + .d.ts)
npm test        # must be green before tagging
git add -f dist # dist/ is gitignored; force-add it deliberately at release
git tag <tag> && git push origin <tag>
```

Consumers then pin `"github:A-Mannan/6figs-tee#<tag-sha>"` and run a fresh
`npm install` to confirm it resolves byte-identical code.

## Frontend (Next.js)

Three steps: connect wallets, sign the ownership message, submit.

```ts
import {
  RegistrationClient,
  type WalletDescriptor,
} from "@sixfigs/tee/client";

const client = new RegistrationClient({
  enclaveUrl: process.env.NEXT_PUBLIC_ENCLAVE_URL!,
  policy: {
    allowedImageDigests: [process.env.NEXT_PUBLIC_IMAGE_DIGEST!],
    allowedProjects: [process.env.NEXT_PUBLIC_GCP_PROJECT!],
    requiredSupportAttributes: ["STABLE"],
  },
});

// 1. Enclave is verified, message to sign is produced.
const prepared = client.prepare({
  wallets: [{ family: "evm", chainId: 1, address } satisfies WalletDescriptor],
  disclosure: "category",
});

// 2. Each wallet signs prepared.message with personal_sign (EVM) or
//    signMessage (Solana) — no transaction, no gas.
const signature = await window.ethereum.request({
  method: "personal_sign",
  params: [prepared.message, address],
});

// 3. Submit; the client re-verifies the enclave signature and attestation.
const signed = await client.submit({
  prepared,
  signatures: { [`evm:${address.toLowerCase()}`]: signature },
});

// 4. Hand the signed result to your backend.
await fetch("/api/verify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(signed),
});
```

There is no identity secret to persist. The account is the wallet set:
`prepare()` derives the identity from the wallet addresses, and `submit()`
encrypts the signed request to the enclave. Re-running with the same wallets
recovers the same identity; adding a wallet requires every already-enrolled
wallet to sign again.

Removing wallets uses the same two-phase flow with per-wallet consent messages:

```ts
// Keep 2, detach 1. `wallets` ∪ `remove` must be the full current membership.
const prepared = client.prepare({
  wallets: [walletA, walletB],
  remove: [walletC],
});

// Kept wallets sign prepared.message; each removed wallet signs its own
// prepared.removalMessages[`family:address`] string.
const signed = await client.submit({
  prepared,
  signatures: {
    [`evm:${walletA.toLowerCase()}`]: sigA,
    [`evm:${walletB.toLowerCase()}`]: sigB,
  },
  removalSignatures: {
    [`evm:${walletC.toLowerCase()}`]: sigCRemoval,
  },
});
```

A detached wallet's binding is deleted by the backend, so it can register a new
account afterwards. A transition without the removed wallet's consent, without
all kept wallets signing, or that omits an enrolled wallet is rejected.

## Backend (NestJS)

```ts
import { Module, Injectable, Controller, Post, Body } from "@nestjs/common";
import {
  SixFigsVerification,
  RegistrationConflict,
  VerificationError,
} from "@sixfigs/tee/verifier";

@Injectable()
class VerificationConfig {
  readonly sixfigs = new SixFigsVerification({
    audience: "6figs-registration",
    policy: {
      allowedImageDigests: [process.env.SIXFIGS_IMAGE_DIGEST!],
      allowedProjects: [process.env.SIXFIGS_GCP_PROJECT!],
      // Start with both schemes during rotation, then narrow to keyed-v1.
      allowedNullifierSchemes: ["legacy-v1", "keyed-v1"],
      requiredSupportAttributes: ["STABLE"],
      allowDebug: false,
    },
    store: new PostgresNullifierStore(pool),
    // Only for local development:
    allowMock: process.env.NODE_ENV !== "production",
  });
}

@Controller("verify")
class VerifyController {
  constructor(private readonly config: VerificationConfig) {}

  @Post()
  async verify(@Body() body: unknown) {
    try {
      // NOTE: echoing body.body.nonce back does not detect replay. Bind the
      // *original* client nonce here only if your frontend forwards it
      // out-of-band; otherwise omit requestNonce (replay then relies on the
      // result TTL and idempotent persistence).
      return await this.config.sixfigs.submit(body as never, {
        requestNonce: (body as any)?.body?.nonce,
      });
    } catch (error) {
      if (error instanceof RegistrationConflict) {
        throw new HttpException("wallet already linked", 409);
      }
      if (error instanceof VerificationError) {
        throw new HttpException(`attestation rejected: ${error.code}`, 400);
      }
      throw error;
    }
  }
}
```

### Postgres store

Implement `NullifierStore` against `db/schema.sql`:

- `getIdentity` → `SELECT * FROM identity WHERE identity_nullifier = $1`
- `bindWallets` → `INSERT ... ON CONFLICT (wallet_nullifier) DO NOTHING` and
  detect a conflicting `identity_nullifier`
- `getWalletOwners` → `SELECT wallet_nullifier, identity_nullifier FROM
  wallet_nullifier WHERE wallet_nullifier = ANY($1)`
- `listWallets` → `SELECT wallet_nullifier, family, chain_id FROM
  wallet_nullifier WHERE identity_nullifier = $1`
- `migrateWallets` → insert the new identity row first, then `DELETE FROM
  wallet_nullifier WHERE wallet_nullifier = ANY($removed)`, then `UPDATE
  wallet_nullifier SET identity_nullifier = $next WHERE wallet_nullifier =
  ANY($wallets)`, then delete the previous identity row
- `upsertRegistration` → `INSERT ... ON CONFLICT (identity_nullifier) DO UPDATE`

Implement `runTransaction` as one locked transaction and perform the whole
submission inside it:

```sql
BEGIN;
-- Lock every row this submission can touch before deciding anything.
SELECT wallet_nullifier, identity_nullifier FROM wallet_nullifier
  WHERE wallet_nullifier = ANY($wallets) FOR UPDATE;
-- ...apply the same checks RegistrationService performs...
-- ...then bind/migrate/delete/upsert...
COMMIT;
```

Run each submission in one transaction with the relevant rows locked. The
unique constraint on `wallet_nullifier` is what enforces one-wallet-one-account;
`migrateWallets` moves a whole set and must never leave a kept wallet behind,
and removed rows must be deleted so the wallet is free to re-enroll. The
service only calls store methods inside `runTransaction` after verifying that
every wallet previously enrolled is accounted for: kept wallets re-signed the
new set and removed wallets signed a removal consent. Do not nest
`runTransaction` calls.

### CI guard

Add a check that fails if any address/balance-shaped column appears in the
schema:

```bash
! grep -rniE 'address|balance|wallet_address|token_amount' db/schema.sql
```

## Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_ENCLAVE_URL` | frontend | enclave base URL |
| `NEXT_PUBLIC_IMAGE_DIGEST` | frontend | pinned digest for client-side checks |
| `NEXT_PUBLIC_GCP_PROJECT` | frontend | pinned project |
| `SIXFIGS_IMAGE_DIGEST` | backend | pinned digest for verification |
| `SIXFIGS_GCP_PROJECT` | backend | pinned project |
| `SIXFIGS_RPC_*` | enclave | per-chain RPC endpoints (HTTPS only; plaintext URLs are ignored) |
| `SIXFIGS_RPC_*_SECONDARY` | enclave | optional redundant RPC per chain; value reads must agree within 0.1% |
| `SIXFIGS_RPC_SOLANA_SECONDARY` | enclave | redundant Solana RPC, same agreement rule |
| `SIXFIGS_NULLIFIER_KEY` | enclave | 64-hex secret for keyed nullifiers; required in production |
| `COINGECKO_API_KEY` | enclave | raises pricing rate limits |
| `SIXFIGS_ALLOWED_ORIGIN` | enclave | CORS origin; when unset no cross-origin headers are emitted |
| `SIXFIGS_REGISTRATION_BUDGET_MS` | enclave | dev/test override for the 30 s registration budget (fails closed) |

## Local end-to-end

```bash
# terminal 1
cd tee
SIXFIGS_MOCK_ATTESTATION=1 SIXFIGS_DEV_INSECURE_BALANCES=1 npm run server

# then use the client SDK against http://localhost:8080
```

The mock provider produces tokens with the same claim shape, so the client-side
attestation check runs unchanged; only the `allowMock` flag differs from
production.