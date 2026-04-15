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
  description = "ALB listener rule priority for /* catch-all routing on the shared botnim.build-up.team host."
  type        = number
  default     = 200
}

variable "mongo_image" {
  description = "MongoDB Docker image tag."
  type        = string
  default     = "mongo:7"
}

variable "meili_image" {
  description = "MeiliSearch Docker image tag."
  type        = string
  default     = "getmeili/meilisearch:v1.7.3"
}

variable "botnim_api_url" {
  description = "URL of the botnim-api service (used by LibreChat's OpenAPI spec override). When null, defaults to https://<env-botnim-fqdn> derived from the platform contract."
  type        = string
  default     = null
}
