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
  encryptEscrowBlob,
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
  wallets: [
    { family: "evm", chainId: 1, address, label: "MetaMask" } satisfies WalletDescriptor,
  ],
  disclosure: "category",
  nonce: backendSessionNonce, // single-use, issued by your backend
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

// 4. Escrow the wallet set to the enclave so the backend can re-verify later
//    without ever holding an address.
const hello = await client.hello();
const escrowBlob = await encryptEscrowBlob(hello.escrowPublicKey, [
  { family: "evm", chainId: 1, address, label: "MetaMask" },
]);

// 5. Hand the signed result and the escrow blob to your backend.
await fetch("/api/verify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ signed, escrowBlob }),
});
```

`signed.body` carries `tier`, `portfolioBand`, and `topAssets` (up to three
symbols, never amounts) — that is everything the profile may show. Rechecks
need no signatures: the backend replays the stored `escrowBlob` to the enclave,
which decrypts it inside, re-fetches balances, and returns a fresh attested
result.

There is no identity secret to persist. The account is the wallet set:
`prepare()` derives the identity from the wallet addresses, and `submit()`
encrypts the signed request to the enclave. Re-running with the same wallets
recovers the same identity.

Adding a wallet needs one signature — from the new wallet only. Your backend
returns the stored identity and escrow blob (opaque ciphertext) for the
authenticated user, and the browser forwards the blob unchanged:

```ts
// 1. Backend: GET a session nonce plus { identityNullifier, escrowBlob } for
//    the verified account.
const prepared = client.prepareAddition({
  added: [newWallet],
  escrowBlob,                    // opaque; fetched from your backend
  accountIdentityNullifier,      // stored identity (a pseudonym)
  nonce: backendSessionNonce,    // single-use
});

// 2. Only the added wallet signs its compact consent message.
const signature = await signMessage(prepared.addMessages[`evm:${newWallet.address.toLowerCase()}`]);

// 3. Submit; the result binds previous → next identity and carries
//    nextEscrowBlob, which the backend stores in place of the old blob.
const signed = await client.submitAddition({
  prepared,
  signatures: { [`evm:${newWallet.address.toLowerCase()}`]: signature },
});
```

The enclave decrypts the blob with its escrow key, refuses a blob whose
recomputed identity differs from `accountIdentityNullifier`, verifies only the
added wallets, merges the set, and re-encrypts it. The backend then verifies
`previousIdentityNullifier` equals the stored identity, every stored wallet is
still present, the claimed `addedWalletNullifiers` are exactly the new ones,
and persists `nextEscrowBlob`.

Removing a wallet (including a lost one) is a threshold transition: every kept
wallet signs one compact challenge naming the removed wallet(s), and the
removed wallet signs nothing. Your backend returns the stored identity and
blob as for an addition; the client supplies the kept wallets and the address
of the wallet to remove:

```ts
// `kept` are the wallets you still control; `remove` is the one to evict.
const prepared = client.prepareRemoval({
  kept,
  remove: [{ family: "solana", chainId: 0, address: lostAddress }],
  escrowBlob,                    // opaque; fetched from your backend
  accountIdentityNullifier,      // stored identity
  nonce: backendSessionNonce,    // single-use
});

// Every kept wallet signs prepared.message (the same string for all of them).
const signatures = Object.fromEntries(
  await Promise.all(kept.map(async (w) => [key(w), await sign(w, prepared.message)])),
);

const signed = await client.submitRemoval({ prepared, signatures });
```

The backend accepts it only when the stored set equals kept ∪ removed, the
previous identity belongs to the session user, and at least one wallet remains.

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
- `migrateWallets` → insert the new identity row first, then `UPDATE
  wallet_nullifier SET identity_nullifier = $next WHERE wallet_nullifier =
  ANY($wallets)`, then delete the previous identity row. (The reference store
  still accepts a removed set for protocol compatibility; the service rejects
  removals before calling it, so pass none.)
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
`migrateWallets` moves a whole set and must never leave a stored wallet behind.
The service only calls store methods inside `runTransaction` after verifying
that every stored wallet is present in the new set, that the claimed added
wallets are exactly new minus stored, and that the base identity matches the
account being extended. Removals are rejected. Do not nest `runTransaction`
calls.

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
| `COINGECKO_API_KEY` | enclave | raises CoinGecko rate limits (optional) |
| `GECKOTERMINAL_API_KEY` | enclave | raises GeckoTerminal rate limits (optional) |
| `SIXFIGS_ESCROW_KEY` | enclave | 64-hex persistent escrow key for `/recheck` and additions; dev/staging only (production requires `SIXFIGS_ALLOW_ENV_ESCROW_KEY=1` or KMS) |
| `SIXFIGS_KMS_KEY` | enclave | Cloud KMS key resource that unwraps the escrow key; takes precedence over the env key |
| `SIXFIGS_KMS_WRAPPED_ESCROW_KEY` | enclave | base64 ciphertext of the 32-byte escrow key, decryptable only by an attested workload |
| `SIXFIGS_KMS_STS_AUDIENCE` | enclave | workload identity provider audience for the STS exchange |
| `SIXFIGS_KMS_SERVICE_ACCOUNT` | enclave | optional service account to impersonate before calling KMS |
| `SIXFIGS_KMS_ATTESTATION_AUDIENCE` | enclave | optional launcher token audience (defaults to the STS audience) |
| `SIXFIGS_KMS_AAD` | enclave | optional UTF-8 additional authenticated data bound to the wrapped key |
| `SIXFIGS_ALLOW_ENV_ESCROW_KEY` | enclave | set to `1` to permit the env escrow key in production; dev-only escape hatch |
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