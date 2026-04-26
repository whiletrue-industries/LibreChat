data "aws_ssm_parameter" "platform_contract" {
  name = "/buildup/shared/${var.environment}/contract"
}

# Aurora DB credentials shared with botnim-api (same DB; AdminPrompts table)
# The Database Provision workflow publishes the secret ARN at this SSM path.
data "aws_ssm_parameter" "database_credentials_secret_arn" {
  name = "/buildup/projects/botnim/prod/database_credentials_secret_arn"
}

locals {
  # The platform contract SSM parameter is marked sensitive end-to-end; the
  # subfields we read here (zone name, subnet IDs) aren't actually secret, so
  # unwrap to avoid sensitive-tainting derived values used as host headers,
  # for_each keys, etc.
  contract    = jsondecode(data.aws_ssm_parameter.platform_contract.value)
  zone_name   = nonsensitive(trimsuffix(local.contract.dns.zone_name, "."))
  botnim_fqdn = "botnim.${local.zone_name}"
}
