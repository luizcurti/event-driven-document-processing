# S3 bucket names are global across every AWS account, so in the cloud the name carries
# this account's ID: the bare "<project>-<env>-documents" is generic enough to already be
# taken (CreateBucket fails with BucketAlreadyExists). LocalStack keeps the short name the
# local scripts and tests use.
locals {
  documents_bucket_name = var.deployment_mode == "cloud" ? "${local.name_prefix}-documents-${data.aws_caller_identity.current.account_id}" : "${local.name_prefix}-documents"
}

resource "aws_s3_bucket" "documents" {
  bucket        = local.documents_bucket_name
  force_destroy = var.documents_bucket_force_destroy

  tags = merge(local.tags, {
    Name = local.documents_bucket_name
  })
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.platform.arn
    }
  }
}

resource "aws_s3_bucket_notification" "documents" {
  bucket      = aws_s3_bucket.documents.id
  eventbridge = true
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning is enabled above; without this, every re-uploaded/re-processed document
# accumulates noncurrent versions forever with no cleanup.
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_dynamodb_table" "documents_metadata" {
  name         = "${local.name_prefix}-documents-metadata"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.platform.arn
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-documents-metadata"
  })
}

resource "aws_sqs_queue" "notifications_dlq" {
  name                      = "${local.name_prefix}-notifications-dlq"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.platform.arn

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-notifications-dlq"
  })
}

resource "aws_sqs_queue" "notifications" {
  name                       = "${local.name_prefix}-notifications"
  visibility_timeout_seconds = 120
  kms_master_key_id          = aws_kms_key.platform.arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notifications_dlq.arn
    maxReceiveCount     = 3
  })

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-notifications"
  })
}

resource "aws_sqs_queue" "lambda_invocations_dlq" {
  name                      = "${local.name_prefix}-lambda-invocations-dlq"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.platform.arn

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-lambda-invocations-dlq"
  })
}

resource "aws_sns_topic" "notifications" {
  name              = "${local.name_prefix}-notifications-topic"
  kms_master_key_id = aws_kms_key.platform.arn

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-notifications-topic"
  })
}

resource "aws_sns_topic_policy" "notifications" {
  arn = aws_sns_topic.notifications.arn

  # Both statements are required for this topic to actually receive anything: SNS does not
  # implicitly trust other AWS services to publish to a topic created outside the console.
  # Without "AllowCloudWatchAlarmsPublish", aws_cloudwatch_metric_alarm.step_functions_failed_executions's
  # alarm_actions would fail to deliver (AccessDenied on Publish), even though `terraform apply`
  # succeeds and the alarm itself evaluates correctly.
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid    = "AllowEventBridgePublish",
        Effect = "Allow",
        Principal = {
          Service = "events.amazonaws.com"
        },
        Action   = "sns:Publish",
        Resource = aws_sns_topic.notifications.arn,
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "AllowCloudWatchAlarmsPublish",
        Effect = "Allow",
        Principal = {
          Service = "cloudwatch.amazonaws.com"
        },
        Action   = "sns:Publish",
        Resource = aws_sns_topic.notifications.arn,
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}
