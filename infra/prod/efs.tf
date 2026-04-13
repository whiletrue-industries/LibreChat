################################################################################
# EFS filesystem for MongoDB + MeiliSearch persistent data
#
# One filesystem with two POSIX-isolated access points — one per sidecar.
# The mount target security group is shared; access control is handled by
# the access points' POSIX UIDs.
################################################################################

module "librechat_efs" {
  source = "git::https://github.com/Build-Up-IL/org-infra.git//modules/ecs-app-efs?ref=feat/ecs-efs-and-sidecars"

  name               = "librechat"
  vpc_id             = local.contract.network.vpc_id
  private_subnet_ids = local.contract.network.private_subnet_ids

  access_points = [
    {
      name      = "mongo"
      path      = "/mongo"
      posix_uid = 999 # default mongo user in the official image
      posix_gid = 999
    },
    {
      name      = "meili"
      path      = "/meili"
      posix_uid = 1000 # meili default
      posix_gid = 1000
    },
  ]
}
