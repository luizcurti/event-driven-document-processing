data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_execution" {
  name               = "${local.name_prefix}-lambda-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda_custom_access" {
  statement {
    sid = "S3Access"
    actions = [
      "s3:PutObject",
      "s3:GetObject"
    ]
    resources = [
      "${aws_s3_bucket.documents.arn}/*"
    ]
  }

  statement {
    sid = "DynamoAccess"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem"
    ]
    resources = [aws_dynamodb_table.documents_metadata.arn]
  }

  statement {
    sid = "QueueAccess"
    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes"
    ]
    resources = [
      aws_sqs_queue.notifications.arn,
      aws_sqs_queue.notifications_dlq.arn
    ]
  }

  statement {
    sid = "TextractAccess"
    actions = [
      "textract:DetectDocumentText",
      "textract:StartDocumentTextDetection",
      "textract:GetDocumentTextDetection"
    ]
    resources = ["*"]
  }

  statement {
    sid = "StepFunctionsCallbackAccess"
    actions = [
      "states:StartExecution",
      "states:SendTaskSuccess",
      "states:SendTaskFailure"
    ]
    resources = ["*"]
  }

  statement {
    sid = "SnsPublishAccess"
    actions = [
      "sns:Publish"
    ]
    resources = [aws_sns_topic.notifications.arn]
  }

  statement {
    sid = "KmsUsage"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey"
    ]
    resources = [aws_kms_key.platform.arn]
  }
}

resource "aws_iam_role_policy" "lambda_custom_access" {
  name   = "${local.name_prefix}-lambda-custom-access"
  role   = aws_iam_role.lambda_execution.id
  policy = data.aws_iam_policy_document.lambda_custom_access.json
}

data "aws_iam_policy_document" "step_functions_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "step_functions" {
  count              = var.enable_step_functions ? 1 : 0
  name               = "${local.name_prefix}-sfn-role"
  assume_role_policy = data.aws_iam_policy_document.step_functions_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "step_functions_invoke_lambdas" {
  count = var.enable_step_functions ? 1 : 0

  statement {
    actions = ["lambda:InvokeFunction"]
    resources = [
      for fn in aws_lambda_function.this : fn.arn
    ]
  }
}

resource "aws_iam_role_policy" "step_functions_invoke_lambdas" {
  count  = var.enable_step_functions ? 1 : 0
  name   = "${local.name_prefix}-sfn-invoke-lambdas"
  role   = aws_iam_role.step_functions[0].id
  policy = data.aws_iam_policy_document.step_functions_invoke_lambdas[0].json
}

