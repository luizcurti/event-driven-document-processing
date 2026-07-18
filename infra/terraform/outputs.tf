output "api_url" {
  description = "Base URL for the upload API."
  value       = aws_apigatewayv2_api.upload_api.api_endpoint
}

output "documents_bucket" {
  description = "Documents bucket."
  value       = aws_s3_bucket.documents.bucket
}

output "step_functions_arn" {
  description = "State machine ARN."
  value       = aws_sfn_state_machine.document_pipeline.arn
}

output "notification_queue_url" {
  description = "Notification queue URL."
  value       = aws_sqs_queue.notifications.url
}

output "notification_topic_arn" {
  description = "Notification SNS topic ARN."
  value       = aws_sns_topic.notifications.arn
}
