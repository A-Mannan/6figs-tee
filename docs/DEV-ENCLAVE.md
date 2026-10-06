# Dev enclave on Google Cloud

DEV ONLY. This deploys the real Confidential Space attestation path against
devnet/testnet chains. The image built here relaxes one launch-policy label
(`allow_env_override`) so configuration can come from VM metadata; production
images keep it empty. Never pin the dev digest in production policy.

## What you get

- One Confidential Space VM running the production boot image family
  (`confidential-space`), so verification behaves exactly like production.
- Solana devnet + Ethereum Sepolia balances priced at mainnet asset prices.
- Real attestation tokens verified by the client/backend with the dev project
  and dev image digest pinned.

Devnet balances are tiny, so the flow usually proves tier 0. For tier-boundary
tests set `SIXFIGS_DEV_INSECURE_BALANCES=1` when creating the VM: the enclave
then returns deterministic large balances instead of RPC reads.

## One-time GCP setup

```bash
gcloud billing projects link sixfigs --billing-account=<BILLING_ACCOUNT_ID>
gcloud services enable compute.googleapis.com artifactregistry.googleapis.com \
  logging.googleapis.com confidentialcomputing.googleapis.com --project sixfigs

gcloud artifacts repositories create tee --repository-format=docker \
  --location=us-central1 --project sixfigs

gcloud iam service-accounts create tee-dev-vm \
  --display-name="6figs tee dev VM" --project sixfigs
gcloud projects add-iam-policy-binding sixfigs \
  --member=serviceAccount:tee-dev-vm@sixfigs.iam.gserviceaccount.com \
  --role=roles/confidentialcomputing.workloadUser
gcloud artifacts repositories add-iam-policy-binding tee \
  --location=us-central1 --project sixfigs \
  --member=serviceAccount:tee-dev-vm@sixfigs.iam.gserviceaccount.com \
  --role=roles/artifactregistry.reader

gcloud compute firewall-rules create allow-tee-dev-8080 --project sixfigs \
  --allow=tcp:8080 --source-ranges=0.0.0.0/0

The rule is deliberately open: the dev ISP rotates the client IPv4, and the
enclave is a public registration endpoint anyway (attestation pins the image,
every request and result is encrypted/signed, and the server rate-limits).

gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
```

## Build and push the dev image

```bash
SIXFIGS_WORKLOAD_PROJECT=sixfigs SIXFIGS_ARTIFACT_REPOSITORY=tee \
  ./scripts/build-image-dev.sh
```

The script prints the digest. Keep it for the client/backend policy.

## Create the VM

Put dev values in `.env.dev` (gitignored) and source it:

```bash
set -a; source .env.dev; set +a
SIXFIGS_VM_PROJECT=sixfigs \
SIXFIGS_WORKLOAD_PROJECT=sixfigs \
SIXFIGS_ARTIFACT_REPOSITORY=tee \
SIXFIGS_VM_ZONE=us-central1-c \
SIXFIGS_SERVICE_ACCOUNT=tee-dev-vm@sixfigs.iam.gserviceaccount.com \
  ./scripts/create-vm-dev.sh
```

Confidential capacity moves around: a stopped VM can fail to start with
`ZONE_RESOURCE_POOL_EXHAUSTED`. The workload is stateless, so delete it and
recreate in another zone (`us-central1-c` worked when `-a` and `-f` were
stocked out); the external IP may change.

`create-vm-dev.sh` forwards `SIXFIGS_RPC_SOLANA`, optional
`SIXFIGS_RPC_SEPOLIA`, `SIXFIGS_NULLIFIER_KEY`, `SIXFIGS_ESCROW_KEY`,
`COINGECKO_API_KEY`, and `SIXFIGS_DEV_INSECURE_BALANCES` as `tee-env-*`
metadata. When `SIXFIGS_ESCROW_KEY` is set it also sets
`SIXFIGS_ALLOW_ENV_ESCROW_KEY=1`, because the image runs
`NODE_ENV=production` and otherwise refuses the environment key. To exercise
the KMS path instead, set `SIXFIGS_KMS_KEY`, `SIXFIGS_KMS_WRAPPED_ESCROW_KEY`,
and `SIXFIGS_KMS_STS_AUDIENCE` (optional `SIXFIGS_KMS_SERVICE_ACCOUNT`); the
dev image allowlist forwards them. Add `SIXFIGS_KMS_WRAPPED_NULLIFIER_KEY` to
release the nullifier key the same way, removing both secrets from the VM
environment. Required in `.env.dev`:

```
SIXFIGS_RPC_SOLANA=https://api.devnet.solana.com
SIXFIGS_RPC_SEPOLIA=https://ethereum-sepolia-rpc.publicnode.com
SIXFIGS_NULLIFIER_KEY=<openssl rand -hex 32>
SIXFIGS_ESCROW_KEY=<openssl rand -hex 32>   # persistent; keep it across VM recreations
SIXFIGS_ALLOWED_ORIGIN=http://localhost:3000
```

`SIXFIGS_ALLOWED_ORIGIN=*` is honored for testing when the frontend origin
rotates (Netlify previews). When the dev VM is put behind the GCP HTTPS load
balancer, add `SIXFIGS_TRUST_PROXY=1` and restrict the firewall to the GFE
ranges (`130.211.0.0/22`, `35.191.0.0/16`) so rate limiting still sees real
clients.

The nullifier and escrow keys are dev keys. They are visible in VM metadata to
anyone with `compute.instances.get`; never reuse them and never treat dev
nullifiers or blobs as portable to production. Recheck and wallet-addition
smokes need the same `SIXFIGS_ESCROW_KEY` across VM recreations.

## Verify

```bash
IP=$(gcloud compute instances describe sixfigs-enclave-dev \
  --zone us-central1-c --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
curl -s "http://$IP:8080/healthz"
```

Then verify the real attestation from Node:

```ts
import { RegistrationClient } from "@sixfigs/tee/client";

const client = new RegistrationClient({
  enclaveUrl: `http://${IP}:8080`,
  policy: {
    allowedImageDigests: ["sha256:<dev digest>"],
    allowedProjects: ["sixfigs"],
  },
});
console.log(await client.hello());
```

Smoke the full path (registration + escrow + recheck, no signatures beyond the
fresh wallet):

```bash
node --experimental-strip-types scripts/smoke-enclave.ts \
  http://<IP>:8080 sha256:<digest> sixfigs solana
```

Live instance (2026-10-01): `sixfigs-enclave-dev` in `us-east1-b`,
`http://34.73.89.203:8080`, digest
`sha256:2b5f840b2a009940f8a2ba7fdc0654dc8f2620a2542b851bec74cec5073fe232`.
This VM still runs an early image (policy `6figs-tee-2026-10-a`), so the
newer add/remove and pricing flows (current policy `6figs-tee-2026-10-d`) will
fail against it. Rebuild and recreate the VM from the current `main` before
dev-testing; then point the apps' expected policy version and digest at the new
build. Local mock-enclave testing does not need the VM.
Rebuilding the image changes the digest; recreating the VM may change the IP —
re-pin both in app configs afterwards.

App dev config to point at the VM:

```
NEXT_PUBLIC_ENCLAVE_URL=http://<IP>:8080
NEXT_PUBLIC_IMAGE_DIGEST=sha256:<dev digest>
NEXT_PUBLIC_GCP_PROJECT=sixfigs
SIXFIGS_IMAGE_DIGEST=sha256:<dev digest>
SIXFIGS_GCP_PROJECT=sixfigs
SIXFIGS_ALLOWED_NULLIFIER_SCHEMES=keyed-v1
```

## Operations

```bash
# Cost control: stop when not in use; start reruns the workload cleanly.
gcloud compute instances stop sixfigs-enclave-dev --zone us-central1-c
gcloud compute instances start sixfigs-enclave-dev --zone us-central1-c

# Toggle tier-test balances on an existing VM (stop, add, start).
gcloud compute instances stop sixfigs-enclave-dev --zone us-central1-c
gcloud compute instances add-metadata sixfigs-enclave-dev --zone us-central1-c \
  --metadata=tee-env-SIXFIGS_DEV_INSECURE_BALANCES=1
gcloud compute instances start sixfigs-enclave-dev --zone us-central1-c
# Remove the key with `remove-metadata --keys=...` to return to real-chain mode.

# If the workload fails to start, read the launcher serial console.
gcloud compute instances get-serial-port-output sixfigs-enclave-dev \
  --zone us-central1-c | tail -50

# Rebuild after code changes: push a new digest, recreate the VM (a restart
# alone keeps the old image).
gcloud compute instances delete sixfigs-enclave-dev --zone us-central1-c
```

Roughly $60/month left running; stop/start or delete for day-to-day dev. The
$300 trial credits expire about 90 days after signup, so don't hoard them.

## Security notes

- Dev image digest belongs only in dev policies; production pins the real
  release digest.
- The dev VM runs the production boot family with `dbgstat` disabled, so
  `allowDebug` stays false and no policy differs except the env allowlist.
- If you must use the `confidential-space-debug` boot family while bringing
  the workload up, set `allowDebug: true` in local dev policies only; never
  pin a debug image in production.