################################################################################
# Secrets Manager entries for LibreChat
#
# Terraform creates the secret resources, but VALUES are set out-of-band.
################################################################################

resource "aws_secretsmanager_secret" "openai_api_key" {
  name        = "librechat/${var.environment}/openai-api-key"
  description = "OpenAI API key used by LibreChat's assistants endpoint"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "librechat/${var.environment}/jwt-secret"
  description = "LibreChat JWT signing secret"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "jwt_refresh_secret" {
  name        = "librechat/${var.environment}/jwt-refresh-secret"
  description = "LibreChat JWT refresh signing secret"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "creds_key" {
  name        = "librechat/${var.environment}/creds-key"
  description = "LibreChat credentials encryption key"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "creds_iv" {
  name        = "librechat/${var.environment}/creds-iv"
  description = "LibreChat credentials encryption IV"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

resource "aws_secretsmanager_secret" "meili_master_key" {
  name        = "librechat/${var.environment}/meili-master-key"
  description = "MeiliSearch master key for chat history indexing"
  kms_key_id  = local.contract.ecs.kms_key_arn
}

# Bootstrap admin user password — consumed by config/create-default-user.js
# at container startup when CREATE_BOOTSTRAP_USER=true and no user exists yet.
# VALUE must be set out-of-band via `aws secretsmanager put-secret-value`;
# see the comment block in main.tf for the exact command.
resource "aws_secretsmanager_secret" "bootstrap_user_password" {
  name        = "librechat/${var.environment}/bootstrap-user-password"
  description = "Initial admin password seeded into LibreChat on first boot"
}
