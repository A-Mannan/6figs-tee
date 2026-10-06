# Proposal

## Why

The frontend is hosted on Netlify and the backend on Render, both HTTPS. The
enclave serves plain HTTP on `:8080`, so the browser refuses the mixed-content
fetch, and `SIXFIGS_ALLOWED_ORIGIN` can pin only one origin. Hosting the
enclave behind a GCP external HTTPS load balancer fixes TLS, but introduces two
gaps this change closes:

- CORS must work from rotating test origins (Netlify previews, custom domain)
  while testing; the current hard pin blocks them.
- Every request now arrives from the load balancer's source IP, so the
  per-client rate limiter collapses all clients into one bucket.

## What Changes

- `SIXFIGS_ALLOWED_ORIGIN=*` is honored explicitly for testing. An unset value
  still emits no cross-origin headers; there is still no implicit wildcard.
- `SIXFIGS_TRUST_PROXY=1` makes the rate limiter key on the client IP that the
  GCP load balancer appends to `X-Forwarded-For`, not the socket peer. Values
  the client supplies are ignored; the flag is only valid when the VM firewall
  restricts `:8080` to the GFE proxy ranges.
- A `scripts/create-lb.sh` runbook for the global external Application Load
  Balancer: reserved static IP, unmanaged instance group, health check on
  `/healthz`, Google-managed certificate, and a backend-service timeout above
  the 30 s registration budget.

## Non-goals

- Trusting arbitrary `X-Forwarded-For` chains or multiple proxy hops.
- Keeping the wildcard origin in production; the launch config pins the exact
  Netlify origin.
- Any change to attestation, envelope, or verification behavior.

## Impact

- `src/enclave/server.ts`, `src/enclave/limits.ts`: origin handling and client
  address resolution.
- `test/`: helper and header coverage.
- `scripts/`, `.env.example`, `docs/INTEGRATION.md`, `docs/DEV-ENCLAVE.md`,
  `docs/SECURITY.md`: deployment inputs and the trust argument.