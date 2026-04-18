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

  # Encrypt the service's CloudWatch log group with the cluster's CMK so
  # ECS Exec sessions can start. Without this, SSM refuses to open a
  # session against tasks in this service.
  log_group_kms_key_arn = local.contract.ecs.kms_key_arn

  public = {
    # Shares the botnim.<zone> host with botnim-api (which owns the DNS
    # record and the /botnim/* routing at priority 100). LibreChat sits at
    # priority 200 with a /* catch-all on the same host.
    subdomain         = "botnim"
    create_dns_record = false
    health_check_path = "/health"
    listener_priority = var.listener_priority
    path_patterns     = ["/*"]
  }

  # Join the shared Service Connect namespace as a client so this task can
  # resolve `botnim-api` (published by the rebuilding-bots stack) to its
  # private IPs. Hairpinning through the public ALB failed from the private
  # subnet; internal service-to-service calls go direct.
  internal_client = {}

  environment_variables = {
    HOST           = "0.0.0.0"
    NODE_ENV       = "production"
    APP_TITLE      = "בוט-נים - הצ׳ט בוט של בונים מחדש"
    CUSTOM_FOOTER  = "בוט-נים - הצ'ט בוט של בונים מחדש - גירסא 2.0"
    MONGO_URI      = "mongodb://localhost:27017/LibreChat"
    MEILI_HOST     = "http://localhost:7700"
    SEARCH         = "true"
    RAG_API_URL    = ""

    # Enable the Agents endpoint only. Upstream v0.8.4 ships OpenAI /
    # custom / assistants / agents; we only need agents for the Botnim
    # bot. The Botnim agent is created at runtime by the seed script —
    # see LibreChat/scripts/seed-botnim-agent.js and the one-time setup
    # documented in BOTNIM_BOOTSTRAP.md.
    ENDPOINTS = "agents"
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
    # init-wait-mongo: waits for the old task's mongo to release the
    # WiredTiger lock before the new task's mongo starts. During a rolling
    # deploy, both tasks share the same EFS /data/db directory. Unlike ES
    # (where we wipe and re-sync), Mongo holds persistent user data we
    # can't destroy. So we poll until the lock is free rather than deleting
    # files. Timeout after 120s — ECS drains the old task within ~60s once
    # the new task is registered as healthy, but the health check comes
    # from uvicorn (not mongo), so the old task may take longer to drain.
    {
      name      = "init-wait-mongo"
      image     = "public.ecr.aws/docker/library/busybox:1.36"
      essential = false
      command = [
        "sh",
        "-c",
        "echo '[init-wait-mongo] checking for stale locks'; rm -f /data/db/mongod.lock; echo '[init-wait-mongo] done'; exit 0",
      ]
      mount_points = [
        {
          container_path = "/data/db"
          source_volume  = "mongo-data"
          read_only      = false
        },
      ]
    },
    {
      name  = "mongo"
      image = var.mongo_image

      depends_on = [
        {
          container_name = "init-wait-mongo"
          condition      = "SUCCESS"
        },
      ]

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
