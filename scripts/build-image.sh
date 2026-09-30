#!/usr/bin/env bash
# Build and push the enclave workload image to Artifact Registry.
#
# The printed image digest is the value to put in the backend's
# allowedImageDigests policy and in the client's attestation policy. Pin the
# digest, not the tag, when verifying attestations.
set -euo pipefail

: "${SIXFIGS_WORKLOAD_PROJECT:?set SIXFIGS_WORKLOAD_PROJECT}"
: "${SIXFIGS_ARTIFACT_REPOSITORY:?set SIXFIGS_ARTIFACT_REPOSITORY}"
: "${SIXFIGS_IMAGE_NAME:=enclave}"
: "${SIXFIGS_IMAGE_TAG:=latest}"

REGION="${SIXFIGS_ARTIFACT_REGION:-us-central1}"
IMAGE="${REGION}-docker.pkg.dev/${SIXFIGS_WORKLOAD_PROJECT}/${SIXFIGS_ARTIFACT_REPOSITORY}/${SIXFIGS_IMAGE_NAME}:${SIXFIGS_IMAGE_TAG}"

echo "==> Building ${IMAGE}"
docker build --platform=linux/amd64 -t "${IMAGE}" .

echo "==> Pushing ${IMAGE}"
docker push "${IMAGE}"

DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${IMAGE}")"
echo
echo "Image pushed: ${IMAGE}"
echo "Repo digest : ${DIGEST}"
echo
echo "Set this in the backend policy (allowedImageDigests) and the web client:"
echo "  ${DIGEST##*@}"