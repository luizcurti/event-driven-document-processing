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

# Each Lambda gets its own execution role, scoped in locals.lambda_iam_statements to
# only the actions/resources that function actually needs (e.g. the OCR Lambda gets
# s3:GetObject, never s3:*; merge_results gets no resource access at all).
resource "aws_iam_role" "lambda_execution" {
  for_each           = local.lambda_config
  name               = "${local.name_prefix}-${replace(each.key, "_", "-")}-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  for_each   = local.lambda_config
  role       = aws_iam_role.lambda_execution[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Required for the Active tracing_config set on every aws_lambda_function: without
# xray:PutTraceSegments/PutTelemetryRecords the function still runs, it just silently
# fails to emit any trace data.
resource "aws_iam_role_policy_attachment" "lambda_xray" {
  for_each   = local.lambda_config
  role       = aws_iam_role.lambda_execution[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

data "aws_iam_policy_document" "lambda_custom_access" {
  for_each = local.lambda_iam_statements_nonempty

  dynamic "statement" {
    for_each = each.value
    content {
      sid       = statement.value.sid
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "lambda_custom_access" {
  for_each = local.lambda_iam_statements_nonempty
  name     = "${local.name_prefix}-${replace(each.key, "_", "-")}-custom-access"
  role     = aws_iam_role.lambda_execution[each.key].id
  policy   = data.aws_iam_policy_document.lambda_custom_access[each.key].json
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

  # Only the 5 functions the state machine template actually invokes (Task/Resource ==
  # lambda:invoke or lambda:invoke.waitForTaskToken). upload, get_document,
  # start_workflow, and notification are invoked by API Gateway/EventBridge/SQS, not by
  # Step Functions, and ocr_callback is invoked by SNS via the async Textract callback
  # — none of them need to be reachable from this role.
  statement {
    actions = ["lambda:InvokeFunction"]
    resources = [
      for key in ["ocr", "thumbnail", "validation", "merge_results", "metadata"] :
      aws_lambda_function.this[key].arn
    ]
  }
}

resource "aws_iam_role_policy" "step_functions_invoke_lambdas" {
  count  = var.enable_step_functions ? 1 : 0
  name   = "${local.name_prefix}-sfn-invoke-lambdas"
  role   = aws_iam_role.step_functions[0].id
  policy = data.aws_iam_policy_document.step_functions_invoke_lambdas[0].json
}

# Required for the tracing_configuration set on aws_sfn_state_machine.document_pipeline.
resource "aws_iam_role_policy_attachment" "step_functions_xray" {
  count      = var.enable_step_functions ? 1 : 0
  role       = aws_iam_role.step_functions[0].name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}
