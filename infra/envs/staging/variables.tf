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
  description = "Desired ECS task count. Must stay at 0 or 1 — the task has stateful Mongo and Meili sidecars with EFS volumes that cannot be shared across tasks."
  type        = number
  default     = 0

  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 1
    error_message = "desired_count must be 0 or 1. Horizontal scaling is not supported due to stateful sidecars."
  }
}

variable "listener_priority" {
  description = "ALB listener rule priority for /* catch-all on the shared botnim host. Staging botnim-api owns priority 300; LibreChat sits at 310."
  type        = number
  default     = 310
}

variable "mongo_image" {
  # Mirrored to private ECR to avoid Docker Hub anonymous pull rate limits.
  description = "MongoDB Docker image tag."
  type        = string
  default     = "377114444836.dkr.ecr.il-central-1.amazonaws.com/mirror/mongo:7"
}

variable "meili_image" {
  # Mirrored to private ECR (377114444836.dkr.ecr.il-central-1.amazonaws.com/mirror/meilisearch:v1.7.3)
  # because Docker Hub's anonymous pull rate limit (shared across all Fargate
  # tasks behind the same NAT gateway) blocks rolling deploys with 429s.
  description = "MeiliSearch Docker image tag."
  type        = string
  default     = "377114444836.dkr.ecr.il-central-1.amazonaws.com/mirror/meilisearch:v1.7.3"
}

variable "botnim_api_url" {
  description = "URL of the botnim-api service (used by LibreChat's OpenAPI spec override). When null, defaults to https://<env-botnim-fqdn> derived from the platform contract."
  type        = string
  default     = null
}
