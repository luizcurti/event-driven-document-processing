locals {
  name_prefix = "${var.project_name}-${var.environment}"

  tags = {
    Project      = var.project_name
    Environment  = var.environment
    ManagedBy    = "Terraform"
    Architecture = "DDD-Clean-Hexagonal"
  }

  # reserved_concurrency caps how much of the account's shared concurrency pool each
  # function can consume, so a bug (e.g. a runaway retry loop) in one function can't
  # starve every other Lambda in the account.
  lambda_config = {
    upload = {
      handler              = "functions/upload.handler"
      timeout              = 30
      reserved_concurrency = 10
    }
    get_document = {
      handler              = "functions/get-document.handler"
      timeout              = 15
      reserved_concurrency = 10
    }
    start_workflow = {
      handler              = "functions/start-workflow.handler"
      timeout              = 30
      reserved_concurrency = 5
    }
    ocr = {
      handler              = "functions/ocr.handler"
      timeout              = 60
      reserved_concurrency = 5
    }
    ocr_callback = {
      handler              = "functions/ocr-callback.handler"
      timeout              = 60
      reserved_concurrency = 10
    }
    thumbnail = {
      handler              = "functions/thumbnail.handler"
      timeout              = 60
      reserved_concurrency = 5
    }
    validation = {
      handler              = "functions/validation.handler"
      timeout              = 30
      reserved_concurrency = 5
    }
    merge_results = {
      handler              = "functions/merge-results.handler"
      timeout              = 30
      reserved_concurrency = 5
    }
    metadata = {
      handler              = "functions/metadata.handler"
      timeout              = 30
      reserved_concurrency = 5
    }
    notification = {
      handler              = "functions/notification.handler"
      timeout              = 30
      reserved_concurrency = 5
    }
  }

  # The only two functions AWS invokes asynchronously (EventBridge -> start_workflow,
  # SNS -> ocr_callback): async invocations get an automatic Lambda-managed retry, and
  # only these need a dead_letter_config, since sync-invoked functions (API Gateway,
  # Step Functions Task) return the error straight to their caller instead.
  async_invoked_lambdas = ["start_workflow", "ocr_callback"]

  # Built from the name rather than referencing aws_sfn_state_machine.document_pipeline:
  # the state machine depends on the Lambdas, which depend on their role policies
  # (lambda.tf), so a direct reference here would be a dependency cycle.
  state_machine_arn = "arn:aws:states:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:stateMachine:${local.name_prefix}-pipeline"

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
      { sid = "StartPipeline", actions = ["states:StartExecution"], resources = var.enable_step_functions ? [local.state_machine_arn] : ["*"] },
      { sid = "MetadataStatusUpdate", actions = ["dynamodb:UpdateItem"], resources = [aws_dynamodb_table.documents_metadata.arn] },
      { sid = "InvocationDlq", actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.lambda_invocations_dlq.arn] },
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
      { sid = "InvocationDlq", actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.lambda_invocations_dlq.arn] },
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
