# Rotating the enclave image

Every enclave image rotation must update **four** places together. Missing
one fails closed in the worst way: the KMS release gate rejects the new
image, `ensureEscrowLoaded()` throws at boot by design, and the VM
crash-loops rebooting with no service.

The digest is the identity of the code users trust. The KMS escrow keys are
released **only** to the exact measured image (workload-identity provider
condition), so the image and its gate must move in lockstep.

## The checklist

1. **Build** the image (dev: `SIXFIGS_WORKLOAD_PROJECT=sixfigs
   SIXFIGS_ARTIFACT_REPOSITORY=tee ./scripts/build-image-dev.sh`; prod: the
   same with `build-image.sh`). Note the printed digest.

2. **Rotate the KMS gate** — the workload-identity provider's attribute
   condition pins the image digest:
   ```bash
   gcloud iam workload-identity-pools providers update-oidc confidential-space \
     --workload-identity-pool=sixfigs-confidential --location=global \
     --attribute-condition="assertion.swname == 'CONFIDENTIAL_SPACE' && assertion.dbgstat == 'disabled-since-boot' && assertion.submods.container.image_digest == 'sha256:<NEW>'"
   ```

3. **Point the VM** at the new digest and reset:
   ```bash
   gcloud compute instances add-metadata sixfigs-enclave-dev --zone=us-east1-b \
     --metadata="tee-image-reference=us-central1-docker.pkg.dev/sixfigs/tee/enclave@sha256:<NEW>"
   gcloud compute instances reset sixfigs-enclave-dev --zone=us-east1-b --quiet
   ```

4. **Update the client pins** — backend `SIXFIGS_IMAGE_DIGEST` (env,
   restart) and frontend `NEXT_PUBLIC_IMAGE_DIGEST` (baked, **rebuild**).
   Both accept comma-separated lists; pin `old,new` first so nothing fails
   closed mid-rotation, trim to the new digest after.

## Verify

- `curl -s https://tee.6figs.xyz/healthz` → `{"ok":true,...}`
- The live digest, from the enclave's own signed claims:
  `GET /hello` → `attestation.attestationToken` → JWT payload →
  `submods.container.image_digest` must equal `<NEW>`.

## If it crash-loops

`gcloud compute instances get-serial-port-output sixfigs-enclave-dev
--zone=us-east1-b | tail -30`. `workload task ended and returned non-zero`
right after the launcher mints a token almost always means step 2 was
missed or points at a stale digest. Roll back = steps 2 + 3 with the old
digest.