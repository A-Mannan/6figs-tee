#!/usr/bin/env bash
# Create a Confidential Space VM that runs the 6figs enclave workload.
#
# Production image family is the default. Use "confidential-space-debug" only
# for staging; debug images give the VM operator root and must never serve
# real users or be pinned in attestation policies.
set -euo pipefail

: "${SIXFIGS_WORKLOAD_PROJECT:?set SIXFIGS_WORKLOAD_PROJECT}"
: "${SIXFIGS_ARTIFACT_REPOSITORY:?set SIXFIGS_ARTIFACT_REPOSITORY}"
: "${SIXFIGS_VM_PROJECT:?set SIXFIGS_VM_PROJECT}"
: "${SIXFIGS_VM_ZONE:?set SIXFIGS_VM_ZONE}"
: "${SIXFIGS_VM_NAME:=sixfigs-enclave-1}"
: "${SIXFIGS_SERVICE_ACCOUNT:?set SIXFIGS_SERVICE_ACCOUNT}"

SIXFIGS_IMAGE_NAME="${SIXFIGS_IMAGE_NAME:-enclave}"
SIXFIGS_IMAGE_TAG="${SIXFIGS_IMAGE_TAG:-latest}"
SIXFIGS_CONFIDENTIAL_COMPUTE_TYPE="${SIXFIGS_CONFIDENTIAL_COMPUTE_TYPE:-SEV}"
SIXFIGS_MACHINE_TYPE="${SIXFIGS_MACHINE_TYPE:-n2d-standard-2}"
SIXFIGS_IMAGE_FAMILY="${SIXFIGS_IMAGE_FAMILY:-confidential-space}"
REGION="${SIXFIGS_ARTIFACT_REGION:-us-central1}"

case "${SIXFIGS_CONFIDENTIAL_COMPUTE_TYPE}" in
  SEV) MAINTENANCE_POLICY="MIGRATE" ;;
  *)   MAINTENANCE_POLICY="TERMINATE" ;;
esac

IMAGE_REF="${REGION}-docker.pkg.dev/${SIXFIGS_WORKLOAD_PROJECT}/${SIXFIGS_ARTIFACT_REPOSITORY}/${SIXFIGS_IMAGE_NAME}:${SIXFIGS_IMAGE_TAG}"

# tee-env-* values are only honored if the workload's launch policy allows them.
# Our Dockerfile sets allow_env_override="", so prefer baking config into the
# image or attaching secrets via the service account instead. The RPC URLs here
# are non-secret but must be allowed by the launch policy if overridden.
METADATA="^~^tee-image-reference=${IMAGE_REF}"
# The workload is stateless (ephemeral keys, no local store), so restarting on
# failure is safe. Run at least two such VMs behind a load balancer; no
# affinity is required.
METADATA+="~tee-restart-policy=Always"
# Dev VMs pass tee-env-* entries here; the workload image must allowlist each
# variable in its tee.launch_policy.allow_env_override label. Production
# images keep that label empty, so this only takes effect for dev builds.
if [[ -n "${SIXFIGS_EXTRA_METADATA:-}" ]]; then
  METADATA+="~${SIXFIGS_EXTRA_METADATA}"
fi

echo "==> Creating Confidential Space VM ${SIXFIGS_VM_NAME}"
gcloud compute instances create "${SIXFIGS_VM_NAME}" \
  --project="${SIXFIGS_VM_PROJECT}" \
  --zone="${SIXFIGS_VM_ZONE}" \
  --confidential-compute-type="${SIXFIGS_CONFIDENTIAL_COMPUTE_TYPE}" \
  --machine-type="${SIXFIGS_MACHINE_TYPE}" \
  --maintenance-policy="${MAINTENANCE_POLICY}" \
  --shielded-secure-boot \
  --image-project=confidential-space-images \
  --image-family="${SIXFIGS_IMAGE_FAMILY}" \
  --metadata="${METADATA}" \
  --service-account="${SIXFIGS_SERVICE_ACCOUNT}" \
  --scopes=cloud-platform

echo "==> VM created. The enclave listens on :8080 inside the VM."
echo "    Expose it with a load balancer, or run a reverse proxy that fronts it."
echo "    Verify the live digest before pinning it in policy:"
echo "      gcloud compute instances describe ${SIXFIGS_VM_NAME} --zone ${SIXFIGS_VM_ZONE} \\"
echo "        --format='value(disks[0].source)'"