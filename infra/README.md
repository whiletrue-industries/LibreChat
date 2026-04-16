# LibreChat infra

Terragrunt-managed Terraform deploying this LibreChat fork to the shared ECS
Fargate cluster in `Build-Up-IL/org-infra`.

## Layout

```
infra/
├── root.hcl                  # shared terragrunt config (backend + provider generation)
├── live/prod/                # terragrunt apply point
│   └── terragrunt.hcl
├── envs/prod/                # raw Terraform code
│   ├── main.tf               # modules/app w/ mongo + meili sidecars
│   ├── data.tf
│   ├── variables.tf
│   ├── secrets.tf
│   ├── efs.tf                # EFS filesystem, two access points
│   ├── backups.tf            # S3 bucket for mongodump
│   ├── outputs.tf
│   └── deploy-ecs.yml.template
└── README.md
```

State key in the shared bucket: `projects/librechat/prod/terraform.tfstate`.

## Topology

One Fargate task with three containers:

| Container | Image | Port | Purpose |
|---|---|---|---|
| `api` | (this repo's ECR) | 3080 | LibreChat Node.js app |
| `mongo` | `mongo:7` | 27017 (localhost only) | User auth, chat history |
| `meilisearch` | `getmeili/meilisearch:v1.7.3` | 7700 (localhost only) | Chat history search |

Routing: shared ALB on `botnim.build-up.team`, `/*` catch-all at priority 200.
The `botnim-api` deploy owns `/botnim/*` at priority 100 — search tool calls go
there first, everything else hits LibreChat.

Persistence: one EFS filesystem with two POSIX-isolated access points
(`mongo` UID 999, `meili` UID 1000). Task fixed at `desired_count = 1`.

Secrets (populated out-of-band):
- `librechat/prod/openai-api-key`
- `librechat/prod/jwt-secret`
- `librechat/prod/jwt-refresh-secret`
- `librechat/prod/creds-key`
- `librechat/prod/creds-iv`
- `librechat/prod/meili-master-key`

## Prereqs

1. `Build-Up-IL/org-infra` platform-contract layer applied
2. `Build-Up-IL/org-infra#40` merged — then update `?ref=...` in `envs/prod/main.tf` and `envs/prod/efs.tf` to a stable tag/SHA
3. botnim-api deployed first (so its priority-100 listener rule exists before LibreChat's catch-all)

## First-time deploy

```bash
aws sso login --profile shared-production
export AWS_PROFILE=shared-production

cd infra/live/prod
terragrunt init
terragrunt plan
terragrunt apply

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
ECR_URL=$(terragrunt output -raw ecr_repository_url)
cd ../../..
aws ecr get-login-password --region il-central-1 \
  | docker login --username AWS --password-stdin "$ECR_URL"
docker build -f Dockerfile.multi --target api-build -t "$ECR_URL:v1" .
docker push "$ECR_URL:v1"

cd infra/live/prod
terragrunt apply -var image_tag=v1 -var desired_count=1
```
