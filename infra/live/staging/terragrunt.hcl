include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}//infra/envs/staging"
}

inputs = {
  environment = "staging"

  # Driven by the IMAGE_TAG env var so `make deploy-staging TAG=...`
  # stays the single source of truth. Fallback default is the last
  # known-good tag — bump only when stabilizing on a new baseline.
  image_tag = get_env("IMAGE_TAG", "v0.8.4-botnim-feedback-v4")
}
