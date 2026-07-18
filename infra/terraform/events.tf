resource "aws_cloudwatch_event_rule" "s3_object_created" {
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
  rule      = aws_cloudwatch_event_rule.s3_object_created.name
  target_id = "StartDocumentProcessingPipeline"
  arn       = aws_sfn_state_machine.document_pipeline.arn
  role_arn  = aws_iam_role.eventbridge_start_sfn.arn

  input_transformer {
    input_paths = {
      bucket = "$.detail.bucket.name"
      key    = "$.detail.object.key"
    }
    input_template = <<EOT
{
  "bucket": <bucket>,
  "key": <key>
}
EOT
  }
}
