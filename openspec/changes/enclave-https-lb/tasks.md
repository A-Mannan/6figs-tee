# Tasks

> Resume here. Code tasks land on `main`; the deployment task needs the domain,
> GCP project, and VM coordinates from the owner. Read `## Blockers` first.
> Mark a task `- [x]` only after its stated verification passes.

## Blockers

- [ ] B1 Deployment inputs from the owner: exact hostname, DNS zone, VM project,
  zone, and VM name; confirmation that `gcloud` is authenticated.

## 1. Enclave changes

- [x] 1.1 Explicit wildcard origin: `SIXFIGS_ALLOWED_ORIGIN=*` emits
  `access-control-allow-origin: *`; unset still emits nothing; verified by an
  e2e test asserting both headers (no code change was needed: `setCors` already
  emits any explicitly configured non-empty value)
- [x] 1.2 Client address helper: second-to-last `X-Forwarded-For` entry,
  `net.isIP` validation, socket fallback; verified by unit tests (valid chain,
  spoofed prefix, missing header, malformed entry, IPv6)
- [x] 1.3 Wire `SIXFIGS_TRUST_PROXY=1` into both rate-limited handlers; verified
  by typecheck, a 60-request e2e burst where rotating spoofed prefixes does not
  buy a fresh bucket, and the existing rate-limit tests staying green
- [x] 1.4 Docs and env: `.env.example`, `docs/INTEGRATION.md`,
  `docs/DEV-ENCLAVE.md`, `docs/SECURITY.md` (vector 21), and the dev image
  allowlist include the new variable

## 2. Deployment

- [x] 2.1 `scripts/create-lb.sh`: reserved IP, unmanaged instance group, health
  check `/healthz`, backend service (timeout 60 s), managed cert, URL map,
  target proxy, HTTPS forwarding rule, firewall rules for GFE ranges only
- [ ] 2.2 Provision the LB and DNS `A` record; verify
  `curl -s https://<hostname>/healthz` and a browser `GET /hello` CORS preflight
  (LB created, backend HEALTHY, IP `34.111.195.208`; waiting on the Namecheap
  A record and certificate issuance)
- [ ] 2.3 Point Netlify (`NEXT_PUBLIC_ENCLAVE_URL`) and Render at
  `https://<hostname>`; re-pin `SIXFIGS_ALLOWED_ORIGIN` to the exact frontend
  origin before production

## Verification commands

- `npm test`
- `npm run typecheck`