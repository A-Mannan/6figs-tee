#!/usr/bin/env bash
# Front the enclave VM(s) with a global external Application Load Balancer and
# a Google-managed certificate. The workload keeps serving plain HTTP on :8080;
# TLS terminates at the load balancer, and attestation binds the enclave keys,
# so the proxy cannot substitute them. After this script: add the printed DNS
# A record, wait for the certificate to become ACTIVE, then set
# SIXFIGS_TRUST_PROXY=1 on the workload and remove any public :8080 rule.
set -euo pipefail

: "${SIXFIGS_VM_PROJECT:?set SIXFIGS_VM_PROJECT}"
: "${SIXFIGS_VM_ZONE:?set SIXFIGS_VM_ZONE}"
: "${SIXFIGS_VM_NAME:?set SIXFIGS_VM_NAME}"
: "${SIXFIGS_LB_HOSTNAME:?set SIXFIGS_LB_HOSTNAME, e.g. tee.6figs.xyz}"

NAME="${SIXFIGS_LB_NAME:-sixfigs-enclave-lb}"
NETWORK="${SIXFIGS_NETWORK:-default}"
PROJECT="${SIXFIGS_VM_PROJECT}"
LB_HOST="${SIXFIGS_LB_HOSTNAME}"

echo "==> Reserving global IP ${NAME}-ip"
if ! gcloud compute addresses describe "${NAME}-ip" --project="${PROJECT}" --global >/dev/null 2>&1; then
  gcloud compute addresses create "${NAME}-ip" --project="${PROJECT}" --global --ip-version=IPV4
fi
IP="$(gcloud compute addresses describe "${NAME}-ip" --project="${PROJECT}" --global --format='get(address)')"

echo "==> Creating health check on /healthz"
gcloud compute health-checks create http "${NAME}-health" --project="${PROJECT}" --global \
  --port=8080 --request-path=/healthz --check-interval=10s --timeout=5s

echo "==> Allowing the GFE ranges to reach :8080"
gcloud compute firewall-rules create "${NAME}-allow-8080" --project="${PROJECT}" \
  --network="${NETWORK}" --direction=INGRESS --action=ALLOW --rules=tcp:8080 \
  --source-ranges=130.211.0.0/22,35.191.0.0/16

echo "==> Adding ${SIXFIGS_VM_NAME} to unmanaged instance group ${NAME}-ig"
gcloud compute instance-groups unmanaged create "${NAME}-ig" --project="${PROJECT}" --zone="${SIXFIGS_VM_ZONE}"
gcloud compute instance-groups unmanaged add-instances "${NAME}-ig" --project="${PROJECT}" --zone="${SIXFIGS_VM_ZONE}" --instances="${SIXFIGS_VM_NAME}"
gcloud compute instance-groups unmanaged set-named-ports "${NAME}-ig" --project="${PROJECT}" --zone="${SIXFIGS_VM_ZONE}" --named-ports=http:8080

echo "==> Creating backend service (60 s timeout, above the enclave budget)"
gcloud compute backend-services create "${NAME}-backend" --project="${PROJECT}" --global \
  --protocol=HTTP --port-name=http --health-checks="${NAME}-health" --timeout=60s
gcloud compute backend-services add-backend "${NAME}-backend" --project="${PROJECT}" --global \
  --instance-group="${NAME}-ig" --instance-group-zone="${SIXFIGS_VM_ZONE}"

echo "==> Requesting a managed certificate for ${LB_HOST}"
gcloud compute ssl-certificates create "${NAME}-cert" --project="${PROJECT}" --global --domains="${LB_HOST}"

echo "==> Wiring URL map, HTTPS proxy, and forwarding rule"
gcloud compute url-maps create "${NAME}-urlmap" --project="${PROJECT}" --global --default-service="${NAME}-backend"
gcloud compute target-https-proxies create "${NAME}-https-proxy" --project="${PROJECT}" --global \
  --url-map="${NAME}-urlmap" --ssl-certificates="${NAME}-cert"
gcloud compute forwarding-rules create "${NAME}-https" --project="${PROJECT}" --global \
  --address="${NAME}-ip" --target-https-proxy="${NAME}-https-proxy" --ports=443

cat <<EOF

==> Load balancer created.

DNS (Namecheap -> Advanced DNS): add an A record
  Host : ${LB_HOST%%.*}
  Value: ${IP}
  TTL  : Automatic

The managed certificate stays PROVISIONING until that record resolves, then
turns ACTIVE (usually within an hour). Check with:
  gcloud compute ssl-certificates describe ${NAME}-cert --project=${PROJECT} --global --format='get(managed.status)'

Then verify:
  curl -s https://${LB_HOST}/healthz

Finally enable trusted-proxy mode and remove public :8080 access:
  gcloud compute firewall-rules delete allow-tee-dev-8080 --project=${PROJECT}
  gcloud compute instances add-metadata ${SIXFIGS_VM_NAME} --project=${PROJECT} --zone=${SIXFIGS_VM_ZONE} \\
    --metadata tee-env-SIXFIGS_TRUST_PROXY=1
  gcloud compute instances reset ${SIXFIGS_VM_NAME} --project=${PROJECT} --zone=${SIXFIGS_VM_ZONE}
EOF