resource "aws_cloudwatch_event_rule" "s3_object_created" {
  count       = var.enable_step_functions ? 1 : 0
  name        = "${local.name_prefix}-s3-object-created"
  description = "Triggers Step Functions for new PDFs in the bucket"

  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = {
        name = [aws_s3_bucket.documents.bucket]
      }
      object = {
        key = [{
          suffix = ".pdf"
        }]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "s3_to_step_functions" {
  count     = var.enable_step_functions ? 1 : 0
  rule      = aws_cloudwatch_event_rule.s3_object_created[0].name
  target_id = "StartDocumentProcessingPipelineLambda"
  arn       = aws_lambda_function.this["start_workflow"].arn

  input_transformer {
    input_paths = {
      bucket = "$.detail.bucket.name"
      key    = "$.detail.object.key"
    }
    input_template = <<EOT
{
  "bucket": <bucket>,
  "key": <key>,
  "stateMachineArn": "${aws_sfn_state_machine.document_pipeline[0].arn}"
}
EOT
  }
}

resource "aws_lambda_permission" "allow_eventbridge_start_workflow" {
  count         = var.enable_step_functions ? 1 : 0
  statement_id  = "AllowExecutionFromEventBridgeStartWorkflow"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this["start_workflow"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.s3_object_created[0].arn
}

resource "aws_cloudwatch_event_rule" "step_functions_failed" {
  count       = var.enable_step_functions ? 1 : 0
  name        = "${local.name_prefix}-step-functions-failed"
  description = "Captures failed Step Functions executions"

  event_pattern = jsonencode({
    source      = ["aws.states"]
    detail-type = ["Step Functions Execution Status Change"]
    detail = {
      status          = ["FAILED"]
      stateMachineArn = [aws_sfn_state_machine.document_pipeline[0].arn]
    }
  })
}

resource "aws_cloudwatch_event_target" "step_functions_failed_to_sns" {
  count     = var.enable_step_functions ? 1 : 0
  rule      = aws_cloudwatch_event_rule.step_functions_failed[0].name
  target_id = "NotifyStepFunctionsFailure"
  arn       = aws_sns_topic.notifications.arn
}
