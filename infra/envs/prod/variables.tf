variable "region" {
  description = "AWS region for the deployment (injected by terragrunt)."
  type        = string
  default     = "il-central-1"
}

variable "environment" {
  description = "Deployment environment name (injected by terragrunt)."
  type        = string
  default     = "prod"
}

variable "image_tag" {
  description = "Docker image tag to deploy from the module-managed ECR repository."
  type        = string
  default     = "bootstrap"
}

variable "desired_count" {
  description = "Desired ECS task count applied to each of the three services (api / mongo / meili). After the split-task refactor the api is stateless and can scale horizontally; mongo and meili are single-instance stateful services and MUST stay at 1 — multiple mongo tasks would corrupt the shared EFS WiredTiger locks. To scale the api alone, raise the api service desired_count out-of-band via the AWS console or a separate variable (follow-up work)."
  type        = number
  default     = 0

  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 1
    error_message = "desired_count must be 0 or 1. Horizontal scaling of the api alone is not yet plumbed through; mongo/meili must remain at 1."
  }
}

variable "listener_priority" {
  description = "ALB listener rule priority for /* catch-all on the shared botnim host. Prod botnim-api owns priority 100; LibreChat sits at 200."
  type        = number
  default     = 200
}

variable "mongo_image" {
  # Mirrored to private ECR in the prod account to avoid Docker Hub
  # anonymous pull rate limits (shared across all Fargate tasks behind
  # the same NAT gateway).
  description = "MongoDB Docker image tag."
  type        = string
  default     = "086879295714.dkr.ecr.il-central-1.amazonaws.com/mirror/mongo:7"
}

variable "meili_image" {
  # Mirrored to private ECR in the prod account (086879295714) to avoid
  # Docker Hub anonymous pull rate limits — the same 429 problem that
  # blocks rolling deploys on staging when pulling getmeili/meilisearch
  # directly.
  description = "MeiliSearch Docker image tag."
  type        = string
  default     = "086879295714.dkr.ecr.il-central-1.amazonaws.com/mirror/meilisearch:v1.7.3"
}

variable "botnim_api_url" {
  description = "URL of the botnim-api service (used by LibreChat's OpenAPI spec override). When null, defaults to https://<env-botnim-fqdn> derived from the platform contract."
  type        = string
  default     = null
}

# Admin prompt-management UI wiring + librechat.yaml modelSpecs default-agent
# substitution. Empty string means "no live agent configured" — the entrypoint
# strips modelSpecs and the bot will not be auto-selected. Set to the seeded
# prod agent's id (e.g., "agent_xxxxxxxxxxxxxxxxxxxxx") via terragrunt input
# once prod is bootstrapped.
variable "botnim_agent_id_unified" {
  description = "LibreChat agent ID for the unified (production) Botnim bot. Read by api/server/index.js into app.locals.liveAgentIds.unified, and by docker-entrypoint-render.sh for modelSpecs.list[0].preset.agent_id."
  type        = string
  default     = ""
}
