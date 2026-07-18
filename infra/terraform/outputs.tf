output "api_url" {
  description = "URL base da API de upload."
  value       = aws_apigatewayv2_api.upload_api.api_endpoint
}

output "documents_bucket" {
  description = "Bucket de documentos."
  value       = aws_s3_bucket.documents.bucket
}

output "step_functions_arn" {
  description = "ARN da maquina de estado."
  value       = aws_sfn_state_machine.document_pipeline.arn
}

output "notification_queue_url" {
  description = "URL da fila de notificacoes."
  value       = aws_sqs_queue.notifications.url
}

output "notification_topic_arn" {
  description = "ARN do topico SNS de notificacoes."
  value       = aws_sns_topic.notifications.arn
}
