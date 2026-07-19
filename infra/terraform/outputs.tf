output "api_url" {
  description = "Base URL for the upload API."
  value       = var.enable_api_gateway ? aws_apigatewayv2_api.upload_api[0].api_endpoint : null
}

output "documents_bucket" {
  description = "Documents bucket."
  value       = aws_s3_bucket.documents.bucket
}

output "step_functions_arn" {
  description = "State machine ARN."
  value       = var.enable_step_functions ? aws_sfn_state_machine.document_pipeline[0].arn : null
}

output "notification_queue_url" {
  description = "Notification queue URL."
  value       = aws_sqs_queue.notifications.url
}

output "notification_topic_arn" {
  description = "Notification SNS topic ARN."
  value       = aws_sns_topic.notifications.arn
}
