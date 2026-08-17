locals {
  name_prefix = "${var.project_name}-${var.environment}"

  tags = {
    Project      = var.project_name
    Environment  = var.environment
    ManagedBy    = "Terraform"
    Architecture = "DDD-Clean-Hexagonal"
  }

  lambda_config = {
    upload = {
      handler = "functions/upload.handler"
      timeout = 30
    }
    get_document = {
      handler = "functions/get-document.handler"
      timeout = 15
    }
    start_workflow = {
      handler = "functions/start-workflow.handler"
      timeout = 30
    }
    ocr = {
      handler = "functions/ocr.handler"
      timeout = 60
    }
    ocr_callback = {
      handler = "functions/ocr-callback.handler"
      timeout = 60
    }
    thumbnail = {
      handler = "functions/thumbnail.handler"
      timeout = 60
    }
    validation = {
      handler = "functions/validation.handler"
      timeout = 30
    }
    merge_results = {
      handler = "functions/merge-results.handler"
      timeout = 30
    }
    metadata = {
      handler = "functions/metadata.handler"
      timeout = 30
    }
    notification = {
      handler = "functions/notification.handler"
      timeout = 30
    }
  }

  # Least-privilege building blocks, reused across the per-function statements below.
  dynamo_idempotency_actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
  kms_actions = [
    "kms:Encrypt",
    "kms:Decrypt",
    "kms:ReEncrypt*",
    "kms:GenerateDataKey*",
    "kms:DescribeKey"
  ]

  # Each Lambda gets only the statements it actually needs, instead of one shared
  # role/policy granting the union of every function's permissions to all of them.
  lambda_iam_statements = {
    upload = [
      { sid = "S3PutUpload", actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.documents.arn}/*"] },
      { sid = "MetadataWrite", actions = local.dynamo_idempotency_actions, resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "KmsUsage", actions = local.kms_actions, resources = [aws_kms_key.platform.arn] }
    ]
    get_document = [
      { sid = "MetadataRead", actions = ["dynamodb:GetItem"], resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "KmsUsage", actions = local.kms_actions, resources = [aws_kms_key.platform.arn] }
    ]
    start_workflow = [
      { sid = "StartPipeline", actions = ["states:StartExecution"], resources = var.enable_step_functions ? [aws_sfn_state_machine.document_pipeline[0].arn] : ["*"] },
      { sid = "MetadataStatusUpdate", actions = ["dynamodb:UpdateItem"], resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "KmsUsage", actions = local.kms_actions, resources = [aws_kms_key.platform.arn] }
    ]
    ocr = [
      { sid = "S3ReadDocument", actions = ["s3:GetObject"], resources = ["${aws_s3_bucket.documents.arn}/*"] },
      { sid = "TextractStart", actions = ["textract:StartDocumentTextDetection", "textract:DetectDocumentText"], resources = ["*"] },
      { sid = "PassTextractRole", actions = ["iam:PassRole"], resources = [aws_iam_role.textract_service.arn] },
      { sid = "TaskTokenAccess", actions = local.dynamo_idempotency_actions, resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "TaskCallback", actions = ["states:SendTaskSuccess", "states:SendTaskFailure"], resources = ["*"] },
      { sid = "KmsUsage", actions = local.kms_actions, resources = [aws_kms_key.platform.arn] }
    ]
    ocr_callback = [
      { sid = "TextractGetResult", actions = ["textract:GetDocumentTextDetection"], resources = ["*"] },
      { sid = "ConsumeTaskToken", actions = ["dynamodb:DeleteItem", "dynamodb:GetItem"], resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "TaskCallback", actions = ["states:SendTaskSuccess", "states:SendTaskFailure"], resources = ["*"] },
      { sid = "KmsUsage", actions = local.kms_actions, resources = [aws_kms_key.platform.arn] }
    ]
    thumbnail = [
      { sid = "S3ReadWriteThumbnails", actions = ["s3:GetObject", "s3:PutObject"], resources = ["${aws_s3_bucket.documents.arn}/*"] },
      { sid = "MetadataIdempotency", actions = local.dynamo_idempotency_actions, resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "KmsUsage", actions = local.kms_actions, resources = [aws_kms_key.platform.arn] }
    ]
    validation = [
      { sid = "S3ReadDocument", actions = ["s3:GetObject"], resources = ["${aws_s3_bucket.documents.arn}/*"] },
      { sid = "MetadataIdempotency", actions = local.dynamo_idempotency_actions, resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "KmsUsage", actions = local.kms_actions, resources = [aws_kms_key.platform.arn] }
    ]
    merge_results = []
    metadata = [
      { sid = "MetadataWrite", actions = ["dynamodb:PutItem"], resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "PublishNotificationEvent", actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notifications.arn] },
      { sid = "KmsUsage", actions = local.kms_actions, resources = [aws_kms_key.platform.arn] }
    ]
    notification = [
      { sid = "ConsumeQueue", actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [aws_sqs_queue.notifications.arn] },
      { sid = "PublishTopic", actions = ["sns:Publish"], resources = [aws_sns_topic.notifications.arn] },
      { sid = "MetadataIdempotency", actions = local.dynamo_idempotency_actions, resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "KmsUsage", actions = local.kms_actions, resources = [aws_kms_key.platform.arn] }
    ]
  }

  lambda_iam_statements_nonempty = {
    for k, v in local.lambda_iam_statements : k => v if length(v) > 0
  }
}
