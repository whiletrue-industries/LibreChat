# LibreChat — prod infra

Terraform configuration deploying this LibreChat fork to the shared ECS Fargate
cluster in `Build-Up-IL/org-infra`.

## Topology

One Fargate task with three containers:

| Container | Image | Port | Purpose |
|---|---|---|---|
| `api` | (this repo's ECR) | 3080 | LibreChat Node.js app |
| `mongo` | `mongo:7` | 27017 (localhost only) | User auth, chat history |
| `meilisearch` | `getmeili/meilisearch:v1.7.3` | 7700 (localhost only) | Chat history full-text search |

Routing: shared ALB on `botnim.build-up.team` with path pattern `/*`
(priority 200). The `botnim-api` deploy owns `/botnim/*` at priority 100, so
legal/budget search traffic is routed there first and everything else hits
LibreChat.

Persistence: one EFS filesystem with two access points (`mongo` UID 999, `meili`
UID 1000). Task is fixed at `desired_count = 1`.

Secrets (populated out-of-band via `aws secretsmanager put-secret-value`):
- `librechat/prod/openai-api-key`
- `librechat/prod/jwt-secret`
- `librechat/prod/jwt-refresh-secret`
- `librechat/prod/creds-key`
- `librechat/prod/creds-iv`
- `librechat/prod/meili-master-key`

## Prereqs

1. `Build-Up-IL/org-infra` platform-contract applied (SSM `/buildup/shared/prod/contract` exists)
2. `Build-Up-IL/org-infra#32` merged and the `?ref=...` references updated to a stable tag
3. `botnim-api` deployed first (so the `/botnim/*` routing rule exists at priority 100)

## First-time deploy

```bash
aws sso login --profile shared-production
export AWS_PROFILE=shared-production

cd infra/prod
terraform init
terraform plan -out=bootstrap.tfplan
terraform apply bootstrap.tfplan

# Populate secrets
for key in jwt-secret jwt-refresh-secret creds-key creds-iv meili-master-key; do
  aws secretsmanager put-secret-value \
    --secret-id librechat/prod/$key \
    --secret-string "$(openssl rand -hex 32)"
done
aws secretsmanager put-secret-value \
  --secret-id librechat/prod/openai-api-key \
  --secret-string "sk-..."

# Build & push first image
ECR_URL=$(terraform output -raw ecr_repository_url)
cd ../..
aws ecr get-login-password --region il-central-1 \
  | docker login --username AWS --password-stdin "$ECR_URL"
docker build -f Dockerfile.multi --target api-build -t "$ECR_URL:v1" .
docker push "$ECR_URL:v1"

cd infra/prod
terraform apply -var image_tag=v1 -var desired_count=1
```
