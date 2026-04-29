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
  image_tag = get_env("IMAGE_TAG", "v0.8.4-botnim-split-v1")

  # LibreChat agent ID for the unified Botnim bot.
  #
  # Empty by design — docker-entrypoint-render.sh discovers the id at
  # container start by looking up the agent by name in MongoDB. The
  # seed script reuses agents by name on every run, so the (name → id)
  # mapping is the actual source of truth and survives re-seeding.
  # Set this only to override the lookup for emergency rollback.
  botnim_agent_id_unified = ""
}
