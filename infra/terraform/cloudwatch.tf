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
