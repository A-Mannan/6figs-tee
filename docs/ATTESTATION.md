# Attestation flow

Confidential Space does not use Nitro-style PCRs. The equivalent of "the code
hash" is the container image digest plus the measured image version, and those
are delivered inside a signed JWT from Google Cloud Attestation.

## Claims that matter

From `https://confidentialcomputing.googleapis.com`:

| Claim | Meaning | How we use it |
| --- | --- | --- |
| `swname` | `CONFIDENTIAL_SPACE` for a valid CS image | must equal `CONFIDENTIAL_SPACE` |
| `swversion` | OS image version, e.g. `250101` | informational / policy |
| `dbgstat` | `disabled-since-boot` on production, `enabled` on debug | must not be debug |
| `submods.container.image_digest` | sha256 of our workload image | **pinned allowlist** |
| `submods.gce.project_id` / `zone` | where it runs | **pinned allowlist** |
| `submods.confidential_space.support_attributes` | `LATEST`/`STABLE`/`USABLE` | require `STABLE` |
| `hwmodel` | `GCP_AMD_SEV` / `GCP_INTEL_TDX` | informational |
| `secboot` | Secure Boot enabled | informational |
| `eat_nonce` | nonces we supplied | **binds the token to a key/result** |

## Two uses of the token

**1. Key attestation (`GET /hello`).** The enclave generates an ephemeral
Ed25519 signing key, an ephemeral X25519 encryption key, and a persistent X25519
escrow key at boot. It requests a token with
`nonces = [sha256(ed25519_pubkey || x25519_pubkey || escrow_pubkey)]`. The
browser fetches `/hello`, verifies the token, recomputes that hash from all
three advertised keys, and checks that it appears in the token. Now the browser
knows the key it is encrypting to — and the escrow key its address blob is
encrypted to — is covered by the attestation. A proxy cannot swap in its own
key while keeping a genuine token.

**2. Result attestation (`POST /registration`, `POST /recheck`).** After
computing a tier, the enclave signs the canonical result body with its Ed25519
key and requests a fresh token with

```
nonce = sha256( ed25519_pubkey || "6figs-nonce-v1:" || sha256("6figs-registration-v1|" + canonicalJson(body)) )
```

This binds the token to *both* the signing key and the exact result bytes, so a
token cannot be replayed for a different key or a doctored result.

## Verification policy

`AttestationVerifier` enforces, in order:

1. `signature` verifies over `canonicalJson(body)` with `enclavePublicKey`.
2. `sha256(enclavePublicKey) == keyId`.
3. The token signature validates (PKI x5c chain to the pinned root, or RS256
   against Google's JWKS).
4. `iss`, `aud`, `exp`, `nbf` are valid.
5. `swname == CONFIDENTIAL_SPACE` and not a debug image.
6. `image_digest` is in `allowedImageDigests`, `project_id` in
   `allowedProjects`, zone/support attributes as configured.
7. `eat_nonce` contains the expected binding nonce.
8. `body.policyVersion` matches, `body.nonce` matches the request nonce.
9. The result is not expired and the tier is in range.

Any failure throws `VerificationError`; callers fail closed.

## Token validation endpoints

- OIDC (RS256): `https://confidentialcomputing.googleapis.com/.well-known/openid-configuration`
  then the `jwks_uri`.
- PKI: `https://confidentialcomputing.googleapis.com/.well-known/attestation-pki-root`.
  The root fingerprint is
  `B9:51:20:74:2C:24:E3:AA:34:04:2E:1C:3B:A3:AA:D2:8B:21:23:21` and rotates
  every 10 years, so PKI tokens leak less metadata to Google.

The verifier caches both (JWKS for 1 hour, PKI root for 24 hours). The browser
client fetches the JWKS on every verification and pins nothing; that is the
residual client-side trust gap documented in `SECURITY.md`.

## Rotating the image

Changing the image changes the digest, so WIP/policy allowlists must be updated.
Use `tee-signed-image-repos` plus Sigstore Cosign signatures if you want policy
to survive image churn without manual digest updates. For the first release,
pin the digest explicitly — it is the clearest possible statement of what ran.