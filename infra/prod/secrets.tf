################################################################################
# Secrets Manager entries for LibreChat
#
# The Terraform creates the secret resources, but the VALUES must be set
# out-of-band. The task execution role is granted read access to each ARN.
################################################################################

resource "aws_secretsmanager_secret" "openai_api_key" {
  name        = "librechat/prod/openai-api-key"
  description = "OpenAI API key used by LibreChat's assistants endpoint"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "librechat/prod/jwt-secret"
  description = "LibreChat JWT signing secret"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "jwt_refresh_secret" {
  name        = "librechat/prod/jwt-refresh-secret"
  description = "LibreChat JWT refresh signing secret"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "creds_key" {
  name        = "librechat/prod/creds-key"
  description = "LibreChat credentials encryption key"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "creds_iv" {
  name        = "librechat/prod/creds-iv"
  description = "LibreChat credentials encryption IV"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "meili_master_key" {
  name        = "librechat/prod/meili-master-key"
  description = "MeiliSearch master key for chat history indexing"
  kms_key_id  = local.contract.ecs.kms_key_arn
}
