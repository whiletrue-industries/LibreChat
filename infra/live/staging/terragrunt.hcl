include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}//infra/envs/staging"
}

inputs = {
  environment = "staging"

  # Pinned to mainstream LibreChat v0.8.4. The image at
  # 377114444836.dkr.ecr.il-central-1.amazonaws.com/librechat:v0.8.4
  # is a mirror of ghcr.io/danny-avila/librechat:v0.8.4. Bump this
  # when cutting over to a new upstream release after validating on
  # this branch.
  image_tag = "v0.8.4-botnim-rtl-fb2"
}
