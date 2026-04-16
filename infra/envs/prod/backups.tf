################################################################################
# S3 bucket for MongoDB dumps
################################################################################

locals {
  mongo_backups_bucket_name = "librechat-mongo-backups-${var.environment}"
  mongo_backups_bucket_arn  = "arn:aws:s3:::${local.mongo_backups_bucket_name}"
}

resource "aws_s3_bucket" "mongo_backups" {
  bucket = local.mongo_backups_bucket_name
}

resource "aws_s3_bucket_public_access_block" "mongo_backups" {
  bucket                  = aws_s3_bucket.mongo_backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "mongo_backups" {
  bucket = aws_s3_bucket.mongo_backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "mongo_backups" {
  bucket = aws_s3_bucket.mongo_backups.id

  rule {
    id     = "glacier-then-expire"
    status = "Enabled"

    filter {
      prefix = ""
    }

    transition {
      days          = 30
      storage_class = "GLACIER"
    }

    expiration {
      days = 90
    }
  }
}

data "aws_iam_policy_document" "mongo_backups_write" {
  statement {
    sid    = "WriteBackups"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:ListBucket",
    ]
    resources = [
      local.mongo_backups_bucket_arn,
      "${local.mongo_backups_bucket_arn}/*",
    ]
  }
}
