project_name                   = "document-processing-platform"
environment                    = "prod"
aws_region                     = "eu-west-2"
deployment_mode                = "cloud"
documents_bucket_force_destroy = false

# AWS WAF can't be associated with API Gateway HTTP APIs (only REST APIs, ALB,
# CloudFront, AppSync, Cognito...), so the web ACL association in api.tf fails
# against real AWS for this stack's apigatewayv2 API. Access is already gated by
# AWS_IAM route authorization and stage throttling.
enable_waf = false
