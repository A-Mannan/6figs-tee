# Design

## Client IP behind the load balancer

GCP external Application Load Balancers append exactly two addresses to
`X-Forwarded-For`:

```
X-Forwarded-For: [<supplied-value>,]<client-ip>,<load-balancer-ip>
```

The client can inject leading values; GCP appends the real client and its own
forwarding-rule IP after them and does not verify the leading values. Trust
resides only in the last two entries:

- `entries[length - 2]` is the client IP the GFE saw.
- `entries[length - 1]` is the load balancer's IP.

With `SIXFIGS_TRUST_PROXY=1`, the enclave takes the second-to-last entry,
validates it with `net.isIP`, and falls back to `req.socket.remoteAddress` when
the header is absent or malformed. Untrusted leading entries are never read, so
a client cannot rotate spoofed identities to evade the limiter.

The flag is a trust assertion, not a parser mode: it is correct only when the
VM firewall accepts `:8080` solely from the GFE ranges (`130.211.0.0/22`,
`35.191.0.0/16`). A direct caller from inside those ranges could forge the
header; that hole is closed by the firewall, and the deployment runbook adds it.

Falling back to the socket address on malformed input fails toward overload
protection (clients share a bucket) rather than toward unlimited attempts.

## Wildcard origin

CORS is browser-side and this API carries no cookies or credentials, so
`access-control-allow-origin: *` is functionally safe; it lets any page in a
browser drive registration and burn the per-client budget. It is a testing
convenience only.

Semantics stay fail-closed: no header when unset, wildcard only when literally
configured as `*`. Production sets the exact `https://<app-origin>`.

## Load balancer shape

- Global external Application Load Balancer, reserved global IPv4.
- Unmanaged instance group containing the enclave VM(s); health check on
  `/healthz` (returns 200 only after the escrow key is resolved).
- Google-managed certificate for the chosen hostname; the DNS `A` record points
  at the reserved IP.
- Backend service timeout set above the enclave's 30 s registration budget
  (e.g. 60 s) so a slow registration returns the enclave's own
  `budget_exceeded` instead of an opaque LB 502/504.
- Firewall: allow `130.211.0.0/22` and `35.191.0.0/16` to `tcp:8080`; remove
  any rule that exposes `8080` to `0.0.0.0/0`.