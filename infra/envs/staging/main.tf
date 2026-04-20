################################################################################
# LibreChat on ECS Fargate — split-task / zero-downtime layout
#
# Three separate ECS services, all on the shared cluster:
#
#   1. librechat-staging-api   — stateless, 200/100 deploy config, public via
#                                 shared ALB. Reaches mongo and meili through
#                                 Service Connect.
#   2. librechat-staging-mongo — stateful, 1 replica, EFS-backed, stop-before-
#                                 start. Publishes TCP 27017 via Service Connect.
#                                 Ingress restricted to the api's SG only.
#   3. librechat-staging-meili — stateful, 1 replica, EFS-backed, stop-before-
#                                 start. Publishes TCP 7700 via Service Connect.
#                                 Ingress restricted to the api's SG only.
#
# Mongo is launched with --auth; a root user (librechat) is created at first
# boot from MONGO_INITDB_ROOT_USERNAME / _PASSWORD. The API reads the same
# password via MONGO_URI_SECRET so no shared-state password lives in env.
#
# Upstream images are consumed via `image_override` pointing at the shared
# mirror ECR account. The module-created ECR repos for mongo/meili exist but
# are unused (harmless).
################################################################################

################################################################################
# Mongo root-user credentials (generated + stored in Secrets Manager)
#
# - random_password generates a URL-safe password once, stored in state.
# - The VALUE is written to the secret. Rotating it requires replacing the
#   secret + restarting mongo to re-run the init, and coordinating the api's
#   cutover — so rotation is deliberately manual, not a Terraform-only action.
# - MONGO_URI is a separate secret (composed URI) so the api can read it as
#   a single environment variable.
################################################################################

resource "random_password" "mongo_root" {
  length  = 32
  special = false # mongo URI reserves :/@?, keep it simple
}

resource "aws_secretsmanager_secret" "mongo_root_password" {
  name        = "librechat/${var.environment}/mongo-root-password"
  description = "Mongo root user password for the librechat-${var.environment} data plane. Used by mongo at first-boot init and by the api via MONGO_URI."
}

resource "aws_secretsmanager_secret_version" "mongo_root_password" {
  secret_id     = aws_secretsmanager_secret.mongo_root_password.id
  secret_string = random_password.mongo_root.result
}

locals {
  service_discovery_namespace_name = nonsensitive(local.contract.internal_services.cloud_map_namespace_name)
  mongo_user                       = "librechat"
  mongo_host                       = "mongo.${local.service_discovery_namespace_name}"
  meili_host                       = "meili.${local.service_discovery_namespace_name}"
  mongo_uri                        = "mongodb://${local.mongo_user}:${random_password.mongo_root.result}@${local.mongo_host}:27017/LibreChat?authSource=admin"
}

resource "aws_secretsmanager_secret" "mongo_uri" {
  name        = "librechat/${var.environment}/mongo-uri"
  description = "Full mongodb:// connection string the api container reads into its MONGO_URI environment variable. Derived from the mongo root password + Service Connect DNS name; regenerated automatically when either changes."
}

resource "aws_secretsmanager_secret_version" "mongo_uri" {
  secret_id     = aws_secretsmanager_secret.mongo_uri.id
  secret_string = local.mongo_uri
}

################################################################################
# 1. API service — stateless, zero-downtime
################################################################################

module "librechat_api" {
  source = "git::https://github.com/Build-Up-IL/org-infra.git//modules/app?ref=feat/app-tcp-protocol"

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
  memory = 2048

  log_group_kms_key_arn = local.contract.ecs.kms_key_arn

  public = {
    subdomain         = "botnim"
    create_dns_record = false
    health_check_path = "/health"
    listener_priority = var.listener_priority
    path_patterns     = ["/*"]
  }

  # Reach both mongo and meili through Service Connect AND call back into
  # botnim-api (as before). The shared client SG is the same for all three.
  internal_client = {}

  environment_variables = {
    HOST          = "0.0.0.0"
    NODE_ENV      = "production"
    APP_TITLE     = "בוט-נים - הצ׳ט בוט של בונים מחדש"
    CUSTOM_FOOTER = "בוט-נים - הצ'ט בוט של בונים מחדש - גירסא 2.0"
    MEILI_HOST    = "http://${local.meili_host}:7700"
    SEARCH        = "true"
    RAG_API_URL   = ""

    ENDPOINTS = "agents"

    # Create the bootstrap admin user on first boot (empty users collection).
    # On subsequent boots a user already exists and this is a no-op.
    CREATE_BOOTSTRAP_USER = "true"

    BOTNIM_AGENT_ID_UNIFIED = var.botnim_agent_id_unified
  }

  secret_environment_variables = {
    MONGO_URI               = aws_secretsmanager_secret.mongo_uri.arn
    OPENAI_API_KEY          = aws_secretsmanager_secret.openai_api_key.arn
    JWT_SECRET              = aws_secretsmanager_secret.jwt_secret.arn
    JWT_REFRESH_SECRET      = aws_secretsmanager_secret.jwt_refresh_secret.arn
    CREDS_KEY               = aws_secretsmanager_secret.creds_key.arn
    CREDS_IV                = aws_secretsmanager_secret.creds_iv.arn
    MEILI_MASTER_KEY        = aws_secretsmanager_secret.meili_master_key.arn
    BOOTSTRAP_USER_PASSWORD = aws_secretsmanager_secret.bootstrap_user_password.arn
  }

  # The api is stateless now — no EFS, no sidecar_containers, no
  # primary_container_mount_points.
}

################################################################################
# 2. Mongo service — stateful, stop-before-start (data plane)
#
# Ingress is scoped to ONLY the api's task SG. Other apps in the shared
# cluster with `internal_client = {}` cannot reach port 27017, and even if
# they could, --auth requires credentials. Defense in depth.
################################################################################

module "librechat_mongo" {
  source = "git::https://github.com/Build-Up-IL/org-infra.git//modules/app?ref=feat/app-tcp-protocol"

  app_name       = "librechat-mongo"
  service_name   = "librechat-${var.environment}-mongo"
  container_name = "mongo"
  container_port = 27017

  environment = var.environment

  image_tag      = "unused" # image_override below wins; ECR repo is harmless
  image_override = var.mongo_image

  container_command = ["mongod", "--bind_ip_all", "--auth"]

  desired_count = var.desired_count

  # Service Connect proxy requires >= 512 CPU. Mongo itself is tiny on staging.
  cpu    = 512
  memory = 1024

  log_group_kms_key_arn = local.contract.ecs.kms_key_arn

  internal_server = {
    app_protocol                = "tcp"
    port_name                   = "mongo"
    discovery_name              = "mongo"
    ingress_security_group_ids  = [module.librechat_api.security_group_id]
    ingress_port_override       = 27017
  }

  environment_variables = {
    MONGO_INITDB_ROOT_USERNAME = local.mongo_user
  }

  secret_environment_variables = {
    MONGO_INITDB_ROOT_PASSWORD = aws_secretsmanager_secret.mongo_root_password.arn
  }

  efs_volumes = [
    {
      name               = "mongo-data"
      file_system_id     = module.librechat_efs.file_system_id
      access_point_id    = module.librechat_efs.access_point_ids["mongo"]
      transit_encryption = "ENABLED"
      iam_authorization  = "DISABLED"
      root_directory     = "/"
    },
  ]

  efs_security_group_ids = [module.librechat_efs.mount_target_security_group_id]

  primary_container_mount_points = [
    {
      container_path = "/data/db"
      source_volume  = "mongo-data"
      read_only      = false
    },
  ]

  container_health_check = {
    command = [
      "CMD-SHELL",
      "mongosh --quiet --authenticationDatabase admin -u ${local.mongo_user} -p \"$MONGO_INITDB_ROOT_PASSWORD\" --eval 'db.runCommand({ ping: 1 })'",
    ]
    interval     = 30
    retries      = 5
    start_period = 60
    timeout      = 10
  }

  task_role_policy_json = data.aws_iam_policy_document.mongo_backups_write.json
}

################################################################################
# 3. Meili service — stateful, stop-before-start (search index)
################################################################################

module "librechat_meili" {
  source = "git::https://github.com/Build-Up-IL/org-infra.git//modules/app?ref=feat/app-tcp-protocol"

  app_name       = "librechat-meili"
  service_name   = "librechat-${var.environment}-meili"
  container_name = "meili"
  container_port = 7700

  environment = var.environment

  image_tag      = "unused"
  image_override = var.meili_image

  desired_count = var.desired_count

  cpu    = 512
  memory = 512

  log_group_kms_key_arn = local.contract.ecs.kms_key_arn

  internal_server = {
    app_protocol                = "tcp"
    port_name                   = "meili"
    discovery_name              = "meili"
    ingress_security_group_ids  = [module.librechat_api.security_group_id]
    ingress_port_override       = 7700
  }

  environment_variables = {
    MEILI_NO_ANALYTICS = "true"
    MEILI_ENV          = "production"
  }

  secret_environment_variables = {
    MEILI_MASTER_KEY = aws_secretsmanager_secret.meili_master_key.arn
  }

  efs_volumes = [
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

  primary_container_mount_points = [
    {
      container_path = "/meili_data"
      source_volume  = "meili-data"
      read_only      = false
    },
  ]

  container_health_check = {
    command = [
      "CMD-SHELL",
      "wget -q --spider http://localhost:7700/health || exit 1",
    ]
    interval     = 30
    retries      = 5
    start_period = 30
    timeout      = 10
  }
}

################################################################################
# Feedback-insights + prompts-export scheduled tasks
#
# EventBridge rules trigger ECS RunTask on the api task-def (not mongo/meili).
# The task-def ARN comes from a data source because modules/app does not
# expose it directly; the api container runs the script via containerOverride.
################################################################################

data "aws_ecs_task_definition" "librechat" {
  task_definition = "librechat-${var.environment}-api"
}

data "aws_iam_role" "librechat_execution" {
  name = "librechat-${var.environment}-api-execution-role"
}

data "aws_iam_policy_document" "feedback_scheduled_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "feedback_scheduled" {
  name               = "librechat-${var.environment}-feedback-scheduled"
  assume_role_policy = data.aws_iam_policy_document.feedback_scheduled_trust.json
}

data "aws_iam_policy_document" "feedback_scheduled_run_task" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = [data.aws_ecs_task_definition.librechat.arn]
  }
  statement {
    actions = ["iam:PassRole"]
    resources = [
      module.librechat_api.task_role_arn,
      data.aws_iam_role.librechat_execution.arn,
    ]
  }
}

resource "aws_iam_role_policy" "feedback_scheduled_run_task" {
  role   = aws_iam_role.feedback_scheduled.id
  policy = data.aws_iam_policy_document.feedback_scheduled_run_task.json
}

resource "aws_cloudwatch_event_rule" "feedback_classify" {
  name                = "librechat-${var.environment}-feedback-classify"
  schedule_expression = "cron(0 2 * * ? *)"
}

resource "aws_cloudwatch_event_target" "feedback_classify" {
  rule     = aws_cloudwatch_event_rule.feedback_classify.name
  arn      = nonsensitive(local.contract.ecs.cluster_arn)
  role_arn = aws_iam_role.feedback_scheduled.arn

  ecs_target {
    task_definition_arn = data.aws_ecs_task_definition.librechat.arn
    launch_type         = "FARGATE"

    network_configuration {
      subnets          = nonsensitive(local.contract.network.private_subnet_ids)
      security_groups  = [module.librechat_api.security_group_id]
      assign_public_ip = false
    }
  }

  input = jsonencode({
    containerOverrides = [{
      name    = "api"
      command = ["node", "scripts/classify-feedback-topics.js"]
    }]
  })
}

resource "aws_cloudwatch_event_rule" "feedback_discover" {
  name                = "librechat-${var.environment}-feedback-discover"
  schedule_expression = "cron(0 3 ? * SUN *)"
}

resource "aws_cloudwatch_event_target" "feedback_discover" {
  rule     = aws_cloudwatch_event_rule.feedback_discover.name
  arn      = nonsensitive(local.contract.ecs.cluster_arn)
  role_arn = aws_iam_role.feedback_scheduled.arn

  ecs_target {
    task_definition_arn = data.aws_ecs_task_definition.librechat.arn
    launch_type         = "FARGATE"

    network_configuration {
      subnets          = nonsensitive(local.contract.network.private_subnet_ids)
      security_groups  = [module.librechat_api.security_group_id]
      assign_public_ip = false
    }
  }

  input = jsonencode({
    containerOverrides = [{
      name    = "api"
      command = ["node", "scripts/discover-feedback-clusters.js"]
    }]
  })
}

resource "aws_cloudwatch_event_rule" "prompts_export" {
  name                = "librechat-${var.environment}-prompts-export"
  schedule_expression = "cron(30 2 * * ? *)"
  description         = "Nightly DB → rebuilding-bots/specs agent.txt export"
}

resource "aws_cloudwatch_event_target" "prompts_export" {
  rule     = aws_cloudwatch_event_rule.prompts_export.name
  arn      = nonsensitive(local.contract.ecs.cluster_arn)
  role_arn = aws_iam_role.feedback_scheduled.arn

  ecs_target {
    task_definition_arn = data.aws_ecs_task_definition.librechat.arn
    launch_type         = "FARGATE"

    network_configuration {
      subnets          = nonsensitive(local.contract.network.private_subnet_ids)
      security_groups  = [module.librechat_api.security_group_id]
      assign_public_ip = false
    }
  }

  input = jsonencode({
    containerOverrides = [{
      name    = "api"
      command = ["node", "scripts/export-prompts-to-git.js"]
    }]
  })
}
