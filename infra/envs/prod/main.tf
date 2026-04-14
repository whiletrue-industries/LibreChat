################################################################################
# LibreChat ECS task
#
# One Fargate task with three containers:
#  1. api (primary) — LibreChat Node.js app on :3080
#  2. mongo (sidecar) — MongoDB 7, localhost:27017, EFS-backed
#  3. meilisearch (sidecar) — Meili v1.7, localhost:7700, EFS-backed
#
# Routing: shared ALB host botnim.build-up.team, path pattern /* (catch-all)
# at priority 200. botnim-api deploy owns /botnim/* at priority 100.
#
# Uses modules/app directly (new preferred pattern).
################################################################################

module "librechat" {
  source = "git::https://github.com/Build-Up-IL/org-infra.git//modules/app?ref=feat/ecs-efs-and-sidecars-v2"

  app_name       = "librechat"
  container_port = 3080
  container_name = "api"

  environment = var.environment

  image_tag     = var.image_tag
  desired_count = var.desired_count

  enable_autoscaling = false
  max_capacity       = 1
  min_capacity       = 1

  cpu    = 1024
  memory = 3072

  public = {
    health_check_path = "/health"
    host_headers      = ["botnim.build-up.team"]
    listener_priority = var.listener_priority
    path_patterns     = ["/*"]
  }

  environment_variables = {
    HOST           = "0.0.0.0"
    NODE_ENV       = "production"
    MONGO_URI      = "mongodb://localhost:27017/LibreChat"
    MEILI_HOST     = "http://localhost:7700"
    SEARCH         = "true"
    RAG_API_URL    = ""
    BOTNIM_API_URL = var.botnim_api_url
  }

  secret_environment_variables = {
    OPENAI_API_KEY     = aws_secretsmanager_secret.openai_api_key.arn
    JWT_SECRET         = aws_secretsmanager_secret.jwt_secret.arn
    JWT_REFRESH_SECRET = aws_secretsmanager_secret.jwt_refresh_secret.arn
    CREDS_KEY          = aws_secretsmanager_secret.creds_key.arn
    CREDS_IV           = aws_secretsmanager_secret.creds_iv.arn
    MEILI_MASTER_KEY   = aws_secretsmanager_secret.meili_master_key.arn
  }

  sidecar_containers = [
    {
      name  = "mongo"
      image = var.mongo_image

      command = ["mongod", "--noauth", "--bind_ip", "127.0.0.1"]

      environment = {}

      port_mappings = []

      mount_points = [
        {
          container_path = "/data/db"
          source_volume  = "mongo-data"
          read_only      = false
        },
      ]

      health_check = {
        command      = ["CMD", "mongosh", "--quiet", "--eval", "db.runCommand({ ping: 1 })"]
        interval     = 30
        retries      = 5
        start_period = 60
        timeout      = 10
      }

      cpu    = 256
      memory = 1024
    },
    {
      name  = "meilisearch"
      image = var.meili_image

      environment = {
        MEILI_NO_ANALYTICS = "true"
        MEILI_ENV          = "production"
      }

      secret_environment_variables = {
        MEILI_MASTER_KEY = aws_secretsmanager_secret.meili_master_key.arn
      }

      port_mappings = []

      mount_points = [
        {
          container_path = "/meili_data"
          source_volume  = "meili-data"
          read_only      = false
        },
      ]

      health_check = {
        command      = ["CMD-SHELL", "wget -q --spider http://localhost:7700/health || exit 1"]
        interval     = 30
        retries      = 5
        start_period = 30
        timeout      = 10
      }

      cpu    = 256
      memory = 512
    },
  ]

  efs_volumes = [
    {
      name               = "mongo-data"
      file_system_id     = module.librechat_efs.file_system_id
      access_point_id    = module.librechat_efs.access_point_ids["mongo"]
      transit_encryption = "ENABLED"
      iam_authorization  = "DISABLED"
      root_directory     = "/"
    },
    {
      name               = "meili-data"
      file_system_id     = module.librechat_efs.file_system_id
      access_point_id    = module.librechat_efs.access_point_ids["meili"]
      transit_encryption = "ENABLED"
      iam_authorization  = "DISABLED"
      root_directory     = "/"
    },
  ]

  efs_security_group_ids = [module.librechat_efs.mount_target_security_group_id]

  task_role_policy_json = data.aws_iam_policy_document.mongo_backups_write.json
}
