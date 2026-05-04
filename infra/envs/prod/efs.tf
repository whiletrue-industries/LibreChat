################################################################################
# EFS filesystem for MongoDB and MeiliSearch persistent data
#
# One filesystem with two POSIX-isolated access points — one per stateful
# service. Paths use the v2 suffix to mirror staging; prod EFS is fresh
# (no bundled-task data to migrate from), so v2 is simply the canonical
# path going forward.
################################################################################

module "librechat_efs" {
  source = "git::https://github.com/Build-Up-IL/org-infra.git//modules/ecs-app-efs?ref=feat/ecs-efs-and-sidecars-v2"

  name               = "librechat"
  vpc_id             = local.contract.network.vpc_id
  private_subnet_ids = local.contract.network.private_subnet_ids

  access_points = [
    {
      name      = "mongo"
      path      = "/mongo-v2"
      posix_uid = 999 # default mongo user in the official image
      posix_gid = 999
    },
    {
      name      = "meili"
      path      = "/meili-v2"
      posix_uid = 1000 # meili default
      posix_gid = 1000
    },
  ]
}
