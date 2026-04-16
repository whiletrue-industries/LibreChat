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
    # Call botnim-api via Service Connect (in-VPC) rather than the public
    # ALB. The public hairpin from a NAT'd private subnet back to the same
    # internet-facing ALB was failing with undici "fetch failed" on every
    # BotConfigService prefetch. Service Connect resolves `botnim-api` to
    # the task's private IPs directly. If var.botnim_api_url is set
    # (e.g. for manual override), it still wins.
    BOTNIM_API_URL = coalesce(var.botnim_api_url, "http://botnim-api:8000")

    # Show only the Assistants endpoint (the Botnim bots). Without this,
    # LibreChat also shows raw "OpenAI" and "Plugins" endpoints which use
    # vanilla GPT-4 with no tools — not what users expect.
    ENDPOINTS = "assistants"

    # BotConfig endpoint wiring (post Assistants-API migration). LibreChat's
    # BotConfigService fetches GET ${BOTNIM_API}/botnim/config/<bot>?environment=<env>
    # at request time and passes the returned {model, instructions, tools}
    # directly to client.responses.create(...). Replaces the old
    # openai.beta.assistants.retrieve() path.
    # BotConfigService expects the URL to include the /botnim path prefix
    # when calling a shared-host ALB (the ALB routes /botnim/* to botnim-api
    # and /* to librechat). The magic regex in BotConfigService only adds
    # the prefix for local Docker (nginx hostnames); for staging we provide
    # it explicitly.
    BOTNIM_API         = "${coalesce(var.botnim_api_url, "http://botnim-api:8000")}/botnim"
    BOTNIM_BOT_SLUG    = "unified"
    BOTNIM_ENVIRONMENT = var.environment

    # Bootstrap admin user on first boot.
    #
    # The entrypoint runs `node config/create-default-user.js` when
    # CREATE_BOOTSTRAP_USER=true. It is idempotent: if any user already
    # exists the script exits 0 without touching Mongo. We leave this set
    # permanently — the overhead is a single count() per cold start and
    # it means "was this user ever created?" has a trivially-true answer.
    #
    # Set the password in Secrets Manager OUT OF BAND (terraform only
    # creates the empty secret resource). For staging:
    #   AWS_PROFILE=anubanu-staging aws secretsmanager put-secret-value \
    #     --secret-id librechat/staging/bootstrap-user-password \
    #     --secret-string '<strong-password>'
    # Then trigger a new deploy (workflow_dispatch on Deploy Staging or
    # `terragrunt apply` + `aws ecs update-service --force-new-deployment`).
    #
    # To create additional users after the bootstrap: either ship the
    # OpenID/Keycloak integration (Monday task #2844301706), or flip
    # ALLOW_REGISTRATION=true temporarily, register via /register, flip back.
    CREATE_BOOTSTRAP_USER = "true"
    BOOTSTRAP_USER_EMAIL  = "botnim.staging.admin@build-up.team"
    BOOTSTRAP_USER_NAME   = "Botnim Staging Admin"
  }

  secret_environment_variables = {
    OPENAI_API_KEY          = aws_secretsmanager_secret.openai_api_key.arn
    # Assistants endpoint uses the same OpenAI key. LibreChat requires this
    # as a separate env var even though it's the same underlying credential.
    ASSISTANTS_API_KEY      = aws_secretsmanager_secret.openai_api_key.arn
    JWT_SECRET              = aws_secretsmanager_secret.jwt_secret.arn
    JWT_REFRESH_SECRET      = aws_secretsmanager_secret.jwt_refresh_secret.arn
    CREDS_KEY               = aws_secretsmanager_secret.creds_key.arn
    CREDS_IV                = aws_secretsmanager_secret.creds_iv.arn
    MEILI_MASTER_KEY        = aws_secretsmanager_secret.meili_master_key.arn
    BOOTSTRAP_USER_PASSWORD = aws_secretsmanager_secret.bootstrap_user_password.arn
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
