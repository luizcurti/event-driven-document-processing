resource "aws_lambda_function" "this" {
  for_each = local.lambda_config

  function_name = "${local.name_prefix}-${each.key}"
  role          = aws_iam_role.lambda_execution.arn
  runtime       = "nodejs22.x"
  handler       = each.value.handler
  timeout       = each.value.timeout
  s3_bucket     = var.lambda_artifacts_bucket
  s3_key        = lookup(var.lambda_artifact_keys, each.key, "${var.lambda_artifacts_prefix}/${each.key}.zip")

  source_code_hash = lookup(var.lambda_artifact_hashes, each.key, null)
  kms_key_arn      = aws_kms_key.platform.arn

  environment {
    variables = {
      DOCUMENTS_BUCKET         = aws_s3_bucket.documents.bucket
      DOCUMENTS_METADATA_TABLE = aws_dynamodb_table.documents_metadata.name
      NOTIFICATION_QUEUE_URL   = aws_sqs_queue.notifications.url
      NOTIFICATION_TOPIC_ARN   = aws_sns_topic.notifications.arn
      ENVIRONMENT              = var.environment
    }
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-${each.key}"
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each = local.lambda_config

  name              = "/aws/lambda/${local.name_prefix}-${each.key}"
  retention_in_days = var.logs_retention_in_days
  kms_key_id        = aws_kms_key.platform.arn

  tags = merge(local.tags, {
    Name = "/aws/lambda/${local.name_prefix}-${each.key}"
  })
}

resource "aws_lambda_event_source_mapping" "notification_consumer" {
  event_source_arn = aws_sqs_queue.notifications.arn
  function_name    = aws_lambda_function.this["notification"].arn
  batch_size       = 10
  enabled          = true
}
