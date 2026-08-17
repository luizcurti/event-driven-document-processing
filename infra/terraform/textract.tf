# Async OCR: Textract publishes job-completion notifications here once
# StartDocumentTextDetection finishes, instead of the OCR Lambda blocking on the
# synchronous (15-minute-limited) Textract API.
resource "aws_sns_topic" "textract_completion" {
  name              = "${local.name_prefix}-textract-completion"
  kms_master_key_id = aws_kms_key.platform.arn

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-textract-completion"
  })
}

data "aws_iam_policy_document" "textract_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["textract.amazonaws.com"]
    }
  }
}

# Textract assumes this role to publish to the completion topic (NotificationChannel).
resource "aws_iam_role" "textract_service" {
  name               = "${local.name_prefix}-textract-service"
  assume_role_policy = data.aws_iam_policy_document.textract_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "textract_publish_to_sns" {
  statement {
    sid       = "PublishJobCompletion"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.textract_completion.arn]
  }
}

resource "aws_iam_role_policy" "textract_publish_to_sns" {
  name   = "${local.name_prefix}-textract-publish-sns"
  role   = aws_iam_role.textract_service.id
  policy = data.aws_iam_policy_document.textract_publish_to_sns.json
}

resource "aws_sns_topic_subscription" "textract_completion_to_ocr_callback" {
  topic_arn = aws_sns_topic.textract_completion.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.this["ocr_callback"].arn
}

resource "aws_lambda_permission" "allow_sns_ocr_callback" {
  statement_id  = "AllowExecutionFromSnsTextractCompletion"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this["ocr_callback"].function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.textract_completion.arn
}
