include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}//infra/envs/staging"
}

inputs = {
  environment = "staging"

  # Pin image_tag so terragrunt apply doesn't reset it to the `bootstrap`
  # default and hand ECS a tag that doesn't exist in ECR. Deploy pipelines
  # override this on each run; this is the last-known-good for ad-hoc
  # terragrunt applies (like service-connect infra changes).
  image_tag = "920296e0"
}
