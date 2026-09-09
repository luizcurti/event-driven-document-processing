resource "aws_cloudwatch_metric_alarm" "step_functions_failed_executions" {
  count               = var.enable_step_functions ? 1 : 0
  alarm_name          = "${local.name_prefix}-processing-failures"
  alarm_description   = "Alarm when failed document workflows exceed threshold"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsFailed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  dimensions = {
    StateMachineArn = aws_sfn_state_machine.document_pipeline[0].arn
  }

  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "step_functions_timed_out_executions" {
  count               = var.enable_step_functions ? 1 : 0
  alarm_name          = "${local.name_prefix}-processing-timeouts"
  alarm_description   = "Alarm when document workflows time out"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsTimedOut"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    StateMachineArn = aws_sfn_state_machine.document_pipeline[0].arn
  }

  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "step_functions_aborted_executions" {
  count               = var.enable_step_functions ? 1 : 0
  alarm_name          = "${local.name_prefix}-processing-aborted"
  alarm_description   = "Alarm when document workflows are aborted"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsAborted"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    StateMachineArn = aws_sfn_state_machine.document_pipeline[0].arn
  }

  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  tags = local.tags
}

# Per-Lambda operational alarms: an unhandled error, a throttle (concurrency exhausted,
# see reserved_concurrent_executions in locals.tf), or duration creeping toward the
# function's own timeout are each symptoms a dashboard alone won't page anyone for.
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = local.lambda_config
  alarm_name          = "${local.name_prefix}-${each.key}-errors"
  alarm_description   = "Alarm when the ${each.key} Lambda raises errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.this[each.key].function_name
  }

  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each            = local.lambda_config
  alarm_name          = "${local.name_prefix}-${each.key}-throttles"
  alarm_description   = "Alarm when the ${each.key} Lambda is throttled (reserved concurrency exhausted)"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.this[each.key].function_name
  }

  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_duration" {
  for_each            = local.lambda_config
  alarm_name          = "${local.name_prefix}-${each.key}-duration"
  alarm_description   = "Alarm when the ${each.key} Lambda's duration approaches its configured timeout"
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 300
  statistic           = "Maximum"
  # 80% of the function's own timeout (in ms): a real signal something is close to
  # timing out, not a hardcoded number that means something different for a 15s
  # function than for a 60s one.
  threshold          = each.value.timeout * 1000 * 0.8
  treat_missing_data = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.this[each.key].function_name
  }

  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "api_gateway_5xx" {
  count               = var.enable_api_gateway ? 1 : 0
  alarm_name          = "${local.name_prefix}-api-5xx"
  alarm_description   = "Alarm when the upload API returns server errors"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = aws_apigatewayv2_api.upload_api[0].id
    Stage = aws_apigatewayv2_stage.default[0].name
  }

  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "api_gateway_4xx" {
  count               = var.enable_api_gateway ? 1 : 0
  alarm_name          = "${local.name_prefix}-api-4xx"
  alarm_description   = "Alarm when the upload API's client-error rate spikes (bad requests, throttling, auth failures)"
  namespace           = "AWS/ApiGateway"
  metric_name         = "4xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  # Higher than the 5xx alarm on purpose: some 4xx traffic (bad payloads, retried
  # duplicates hitting a 409) is expected client noise, not an operational incident.
  threshold          = 20
  treat_missing_data = "notBreaching"

  dimensions = {
    ApiId = aws_apigatewayv2_api.upload_api[0].id
    Stage = aws_apigatewayv2_stage.default[0].name
  }

  alarm_actions = [aws_sns_topic.notifications.arn]
  ok_actions    = [aws_sns_topic.notifications.arn]

  tags = local.tags
}
