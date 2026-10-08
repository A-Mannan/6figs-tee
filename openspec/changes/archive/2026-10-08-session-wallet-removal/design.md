# Design

## Capability, not signatures

The backend stores the escrow blob and is the only holder. A request that can
present the blob plus a fresh single-use nonce can ask the enclave to detach
wallets; the enclave authenticates nothing else. This matches `recheck`, which
already trusts blob possession, and is the fastest secure shape available
without a wallet popup.

The envelope nonce is single-use (`SeenNonces`) and the result is bound to it,
so a captured request cannot be replayed and a captured result cannot be
reattached to another request.

## What the enclave verifies

- The blob decrypts and is well-formed.
- The recomputed commitment matches `identityNullifier`, which binds the
  request to the account's stored row and refuses a swapped blob.
- Every requested `walletNullifier` exists in the decrypted set, and at least
  one wallet stays enrolled.
- The signed body carries `previousIdentityNullifier`, the kept set,
  `removedWalletNullifiers`, and a fresh `nextEscrowBlob`.

The backend still enforces its own invariant against its stored bindings: the
new set must be exactly stored-minus-target, and `previousIdentityNullifier`
must equal the row's current commitment. Silent growth or shrinkage is
rejected there, as before.

## Trust tradeoff

A stolen backend session, or the backend operator, can evict wallets: that is
denial of membership, not theft or exposure. The affected wallet can be added
back with its own signature, and no address or balance is revealed. The
threshold path's stronger property — the backend alone cannot remove wallets —
is deliberately exchanged for speed and for lost-wallet recovery.

## Address display

The enclave never returns addresses in results, and the backend never stores
them, so the UI cannot ask either for them. Registered wallets render from the
backend as label + family + nullifier, and the browser shows an address only
for wallets connected in that browser. At registration the client receives the
nullifier list in the signed result, so it can cache an `address → nullifier`
map locally to caption a row with `0x12…abcd` on the device that registered
it. Nothing changes the privacy invariant.