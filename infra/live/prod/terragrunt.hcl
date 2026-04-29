include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}//infra/envs/prod"
}

inputs = {
  environment = "prod"

  # LibreChat agent ID for the unified Botnim bot, created by
  # scripts/seed-botnim-agent.js. Read by api/server/index.js into
  # app.locals.liveAgentIds.unified for the admin prompt-management
  # publish flow, and by docker-entrypoint-render.sh for the modelSpecs
  # default-agent wiring.
  #
  # Empty/unset until prod is bootstrapped — the entrypoint's fallback
  # strips modelSpecs gracefully so the API still boots. Set this to the
  # seeded prod agent's id once available.
  # botnim_agent_id_unified = "agent_xxxxxxxxxxxxxxxxxxxxx"
}
