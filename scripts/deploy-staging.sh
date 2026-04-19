#!/usr/bin/env bash
# Deploy LibreChat to staging.
#
# Usage:
#   IMAGE_TAG=v0.8.4-botnim-feedback-v5 ./scripts/deploy-staging.sh
#   ./scripts/deploy-staging.sh v0.8.4-botnim-feedback-v5
#
# What this does, end-to-end, so you don't have to remember:
#   1. Mac-native `npm run build` (client + packages). No Docker RAM limit.
#   2. `docker buildx build --platform=linux/amd64` with Dockerfile.amd64
#      which overlays Mac-built dists + librechat.yaml on upstream image.
#   3. ECR login + push.
#   4. Terragrunt apply in infra/live/staging with IMAGE_TAG env var
#      driving the image_tag input.
#   5. ECS update-service to force a stop-before-start deployment
#      (maximumPercent=100, minimumHealthyPercent=0) — the LibreChat
#      module defaults to 200/100 and re-applies would revert us.
#   6. Poll ECS until the rollout reports COMPLETED.
#
# Env:
#   IMAGE_TAG        required unless passed as $1
#   AWS_PROFILE      defaults to anubanu-staging
#   ECR              defaults to 377114444836.dkr.ecr.il-central-1.amazonaws.com
#   SKIP_BUILD=1     reuse existing Mac dist (faster re-deploys of infra-only fixes)
#   SKIP_PUSH=1      assume image is already in ECR
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-${1:-}}"
if [[ -z "${IMAGE_TAG}" ]]; then
  echo "ERROR: set IMAGE_TAG (env or arg 1)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LC_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
AWS_PROFILE="${AWS_PROFILE:-anubanu-staging}"
export AWS_PROFILE
ECR="${ECR:-377114444836.dkr.ecr.il-central-1.amazonaws.com}"
CLUSTER="${CLUSTER:-buildup-staging}"
SERVICE="${SERVICE:-librechat-staging-api}"
REGION="${REGION:-il-central-1}"
IMAGE_REF="${ECR}/librechat:${IMAGE_TAG}"

step() { printf "\n\033[1;34m[deploy-staging]\033[0m %s\n" "$*"; }

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  step "1/6  Mac-native build (client + packages)"
  ( cd "$LC_DIR" && npm run build )
else
  step "1/6  SKIP_BUILD=1 — reusing existing dist/"
fi

if [[ "${SKIP_PUSH:-0}" != "1" ]]; then
  step "2/6  docker buildx build --platform=linux/amd64 → ${IMAGE_TAG}"
  docker buildx build --platform=linux/amd64 --load \
    -f "$LC_DIR/Dockerfile.amd64" \
    -t "$IMAGE_REF" \
    "$LC_DIR"

  step "3/6  ECR login + push"
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$ECR"
  docker push "$IMAGE_REF"
else
  step "2-3/6  SKIP_PUSH=1 — assuming ${IMAGE_TAG} is already in ECR"
fi

step "4/6  terragrunt apply (IMAGE_TAG=${IMAGE_TAG})"
IMAGE_TAG="$IMAGE_TAG" terragrunt --working-dir "$LC_DIR/infra/live/staging" \
  apply -auto-approve -compact-warnings -no-color >/tmp/deploy-staging-apply.log 2>&1 \
  || { tail -40 /tmp/deploy-staging-apply.log; exit 1; }

step "5/6  ECS update-service (stop-before-start swap)"
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --region "$REGION" \
  --deployment-configuration "maximumPercent=100,minimumHealthyPercent=0" \
  --availability-zone-rebalancing DISABLED \
  --force-new-deployment >/dev/null

step "6/6  poll ECS until steady state"
for i in $(seq 1 30); do
  sleep 20
  status="$(aws ecs describe-services \
    --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" \
    --query 'services[0].deployments[?status==`PRIMARY`].[rolloutState,runningCount]' \
    --output text)"
  echo "    tick $i/30: $status"
  state="$(awk '{print $1}' <<<"$status")"
  running="$(awk '{print $2}' <<<"$status")"
  if [[ "$state" == "COMPLETED" && "${running:-0}" -ge 1 ]]; then
    step "DONE  https://botnim.staging.build-up.team  (image=${IMAGE_TAG})"
    exit 0
  fi
  if [[ "$state" == "FAILED" ]]; then
    echo "ERROR: rollout FAILED — check AWS ECS console" >&2
    exit 2
  fi
done

echo "ERROR: rollout didn't reach COMPLETED within 10 min" >&2
exit 3
