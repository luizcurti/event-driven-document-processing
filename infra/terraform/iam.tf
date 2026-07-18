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
      "textract:DetectDocumentText"
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
  name               = "${local.name_prefix}-sfn-role"
  assume_role_policy = data.aws_iam_policy_document.step_functions_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "step_functions_invoke_lambdas" {
  statement {
    actions = ["lambda:InvokeFunction"]
    resources = [
      for fn in aws_lambda_function.this : fn.arn
    ]
  }
}

resource "aws_iam_role_policy" "step_functions_invoke_lambdas" {
  name   = "${local.name_prefix}-sfn-invoke-lambdas"
  role   = aws_iam_role.step_functions.id
  policy = data.aws_iam_policy_document.step_functions_invoke_lambdas.json
}

data "aws_iam_policy_document" "eventbridge_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eventbridge_start_sfn" {
  name               = "${local.name_prefix}-eventbridge-sfn-role"
  assume_role_policy = data.aws_iam_policy_document.eventbridge_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "eventbridge_start_sfn" {
  statement {
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.document_pipeline.arn]
  }
}

resource "aws_iam_role_policy" "eventbridge_start_sfn" {
  name   = "${local.name_prefix}-eventbridge-start-sfn"
  role   = aws_iam_role.eventbridge_start_sfn.id
  policy = data.aws_iam_policy_document.eventbridge_start_sfn.json
}
