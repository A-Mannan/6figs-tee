# Design

## One token, two decrypts

Both wrapped blobs use the same KMS key. `GcpKmsEscrowKeyProvider.load()`
performs the attestation token request, STS exchange, and optional service
account impersonation once, then calls `cryptoKeys:decrypt` for each configured
blob with the same access token. A failure on either decrypt fails boot.

The wrapped nullifier key is optional (`SIXFIGS_KMS_WRAPPED_NULLIFIER_KEY`), so
deployments that have not wrapped it keep the environment fallback.

## Deferred keyed scheme

`/hello` must advertise `nullifierScheme` before any request, and the provider
loads asynchronously at boot. The scheme object is therefore created with a
known name (`keyed-v1`) and `pending: true`; `walletNullifier` throws while
pending. `EnclaveKeyManager.ensureEscrowLoaded()` delivers the key returned by
the provider and clears pending.

This is safe because the server only accepts connections after `listen()`,
which awaits `ensureEscrowLoaded()`; a pending scheme cannot hash real requests.
If the scheme is still pending after the provider returns, boot fails with an
explicit error rather than starting a workload that cannot hash.

## Production rule

Selection order for the nullifier scheme:

1. `SIXFIGS_KMS_WRAPPED_NULLIFIER_KEY` set → pending keyed scheme (KMS must
   release it).
2. `SIXFIGS_NULLIFIER_KEY` set → keyed scheme with that key.
3. `NODE_ENV=production` → refuse to boot.
4. Otherwise → legacy scheme for local development.

Wrapping the existing dev nullifier key (rather than generating a new one)
preserves every nullifier derived so far.

## Why not OPRF

A blind OPRF hides the input-output mapping from the client. It was dropped
(see `docs/SECURITY.md`); KMS release closes the metadata-visibility gap
without new cryptography or a new protocol version.