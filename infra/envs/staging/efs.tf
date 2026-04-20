################################################################################
# EFS filesystem for MongoDB and MeiliSearch persistent data
#
# One filesystem with two POSIX-isolated access points — one per sidecar.
################################################################################

module "librechat_efs" {
  source = "git::https://github.com/Build-Up-IL/org-infra.git//modules/ecs-app-efs?ref=feat/ecs-efs-and-sidecars-v2"

  name               = "librechat"
  vpc_id             = local.contract.network.vpc_id
  private_subnet_ids = local.contract.network.private_subnet_ids

  # Path bumped to /mongo-v2 + /meili-v2 during the split-task cutover to
  # give each new stateful service a clean empty root directory. The old
  # /mongo and /meili dirs persist on the EFS but are unreferenced —
  # remove them out-of-band once the new stack is verified.
  #
  # This was necessary because:
  #  - Mongo starts with --auth for the first time; its init script only
  #    creates the root user when the dataDir is EMPTY. Pointing at the
  #    old /mongo (populated by the previous bundled task) would skip init
  #    and leave the api unable to authenticate.
  #  - Meili's data format didn't change but we rebuild its index off the
  #    live Mongo on restart anyway (SEARCH=true), so the loss is cheap.
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
