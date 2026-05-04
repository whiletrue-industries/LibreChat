output "app_url" {
  description = "Public HTTPS URL for LibreChat"
  value       = module.librechat_api.app_url
}

output "ecr_repository_url" {
  description = "ECR repository URL to push api images to. Mongo/meili use image_override against the shared mirror and have their own (unused) ECR repos."
  value       = module.librechat_api.ecr_repository_url
}

output "task_role_arn" {
  description = "IAM task role ARN for the api service"
  value       = module.librechat_api.task_role_arn
}

output "mongo_task_role_arn" {
  description = "IAM task role ARN for the mongo service (mongodump backup policy attached here)"
  value       = module.librechat_mongo.task_role_arn
}

output "librechat_file_system_id" {
  description = "EFS filesystem ID backing mongo and meili data"
  value       = module.librechat_efs.file_system_id
}

output "mongo_backups_bucket" {
  description = "S3 bucket for mongodump archives"
  value       = aws_s3_bucket.mongo_backups.id
}

output "feedback_classify_rule_arn" {
  description = "EventBridge rule ARN for the nightly feedback-classify scheduled task"
  value       = aws_cloudwatch_event_rule.feedback_classify.arn
}

output "feedback_discover_rule_arn" {
  description = "EventBridge rule ARN for the weekly feedback-discover scheduled task"
  value       = aws_cloudwatch_event_rule.feedback_discover.arn
}

output "prompts_export_rule_arn" {
  description = "EventBridge rule ARN for the nightly prompts-export scheduled task"
  value       = aws_cloudwatch_event_rule.prompts_export.arn
}
