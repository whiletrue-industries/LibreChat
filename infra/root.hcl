# Terragrunt root config for LibreChat app state.
#
# Apps share the buildup-org-infra S3 state buckets (one per env) under a
# project-scoped key prefix.

locals {
  region             = "il-central-1"
  project_state_name = "librechat"
  environment        = basename(path_relative_to_include())
  state_buckets = {
    prod    = "buildup-org-tfstate-prod"
    staging = "buildup-org-tfstate-staging"
  }
  state_bucket = local.state_buckets[local.environment]
}

remote_state {
  backend = "s3"

  generate = {
    path      = "backend_generated.tf"
    if_exists = "overwrite_terragrunt"
  }

  config = {
    bucket                 = local.state_bucket
    key                    = "projects/${local.project_state_name}/${path_relative_to_include()}/terraform.tfstate"
    region                 = local.region
    encrypt                = true
    skip_region_validation = true
    use_lockfile           = true
  }
}

generate "provider" {
  path      = "provider_generated.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF
    terraform {
      required_version = ">= 1.7.0"
      required_providers {
        aws = {
          source  = "hashicorp/aws"
          version = "~> 6.37"
        }
      }
    }

    provider "aws" {
      region = "${local.region}"

      default_tags {
        tags = {
          Project     = "${local.project_state_name}"
          Environment = "${basename(path_relative_to_include())}"
          ManagedBy   = "terragrunt"
        }
      }
    }
  EOF
}

inputs = {
  region = local.region
}
