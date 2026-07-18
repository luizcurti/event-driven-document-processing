resource "aws_s3_bucket" "documents" {
  bucket        = "${local.name_prefix}-documents"
  force_destroy = var.documents_bucket_force_destroy

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-documents"
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
  visibility_timeout_seconds = 60
  kms_master_key_id          = aws_kms_key.platform.arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notifications_dlq.arn
    maxReceiveCount     = 5
  })

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-notifications"
  })
}

resource "aws_sns_topic" "notifications" {
  name              = "${local.name_prefix}-notifications-topic"
  kms_master_key_id = aws_kms_key.platform.arn

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-notifications-topic"
  })
}
