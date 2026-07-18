resource "aws_cloudwatch_log_group" "step_functions" {
  name              = "/aws/vendedlogs/states/${local.name_prefix}-pipeline"
  retention_in_days = var.logs_retention_in_days
  kms_key_id        = aws_kms_key.platform.arn
  tags              = local.tags
}

resource "aws_sfn_state_machine" "document_pipeline" {
  name     = "${local.name_prefix}-pipeline"
  role_arn = aws_iam_role.step_functions.arn

  definition = templatefile("${path.module}/templates/state-machine.asl.json.tftpl", {
    ocr_lambda_arn           = aws_lambda_function.this["ocr"].arn
    thumbnail_lambda_arn     = aws_lambda_function.this["thumbnail"].arn
    validation_lambda_arn    = aws_lambda_function.this["validation"].arn
    merge_results_lambda_arn = aws_lambda_function.this["merge_results"].arn
    metadata_lambda_arn      = aws_lambda_function.this["metadata"].arn
  })

  logging_configuration {
    level                  = "ALL"
    include_execution_data = true
    log_destination        = "${aws_cloudwatch_log_group.step_functions.arn}:*"
  }

  tracing_configuration {
    enabled = true
  }

  tags = local.tags
}
