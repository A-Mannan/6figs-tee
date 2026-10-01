# 6figs Confidential Space workload.
#
# Builds the enclave server. The resulting image digest is the value that goes
# into the backend/client attestation policy and is what makes "anyone can read
# the code that ran" checkable. Keep the image minimal and reproducible.

# Base pinned by digest: the image digest is the code users trust, so any
# base-image change is a deliberate, reviewable digest rotation.
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS base
ENV NODE_ENV=production

WORKDIR /app

# Only runtime deps in the final image. `npm ci` installs exactly the locked
# tree; dependency lifecycle scripts are blocked by .npmrc.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

# Launch policies: the VM operator may not override our command, env, mounts,
# capabilities, or enable logging that could exfiltrate witness data.
# TEE_ALLOW_ENV_OVERRIDE exists for dev builds only: it lets a dev VM set the
# allowlisted variables via tee-env-* metadata. Production builds must leave
# it empty so no environment variable can be overridden at launch.
ARG TEE_ALLOW_ENV_OVERRIDE=""
LABEL "tee.launch_policy.allow_cmd_override"="false"
LABEL "tee.launch_policy.allow_env_override"="${TEE_ALLOW_ENV_OVERRIDE}"
LABEL "tee.launch_policy.allow_capabilities"="false"
LABEL "tee.launch_policy.allow_cgroups"="false"
LABEL "tee.launch_policy.log_redirect"="never"
LABEL "tee.launch_policy.monitoring_memory_allow"="never"

EXPOSE 8080

ENV PORT=8080
ENV HOST=0.0.0.0

# Node's native type stripping runs the TypeScript directly; no build step means
# the shipped source is exactly the reviewed source.
ENTRYPOINT ["node", "--experimental-strip-types", "src/enclave/server.ts"]