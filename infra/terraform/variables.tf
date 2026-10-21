variable "project_name" {
  description = "Base project name."
  type        = string
  default     = "document-processing-platform"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"
}

variable "deployment_mode" {
  description = "Deployment mode: cloud (AWS) or local (LocalStack)."
  type        = string
  default     = "cloud"

  validation {
    condition     = contains(["cloud", "local"], var.deployment_mode)
    error_message = "deployment_mode must be either 'cloud' or 'local'."
  }
}

variable "localstack_endpoint" {
  description = "Base LocalStack endpoint used when deployment_mode is local."
  type        = string
  default     = "http://127.0.0.1:4566"
}

variable "local_lambda_zip_path" {
  description = "Path to a local zip artifact with all lambda handlers built in dist/. Used in local mode."
  type        = string
  default     = "../../dist/lambda.zip"
}

variable "thumbnail_lambda_image_uri" {
  description = "Container image URI for thumbnail lambda (ECR), used when set."
  type        = string
  default     = ""
}

variable "enable_waf" {
  description = "Enable WAF resources. Disable in local mode when service support is limited."
  type        = bool
  default     = true
}

variable "waf_rate_limit_per_5min" {
  description = "Max requests a single IP may send to the upload API in any trailing 5-minute window before WAF blocks it."
  type        = number
  default     = 2000
}

variable "enable_api_gateway" {
  description = "Enable API Gateway resources. Disable in local mode when service support is limited."
  type        = bool
  default     = true
}

variable "enable_step_functions" {
  description = "Enable Step Functions orchestration resources."
  type        = bool
  default     = true
}

variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "eu-west-2"
}

variable "documents_bucket_force_destroy" {
  description = "Allow destroying bucket with objects."
  type        = bool
  default     = true
}

variable "lambda_artifacts_bucket" {
  description = "S3 bucket where Lambda zip artifacts are published by the pipeline."
  type        = string
  default     = null
}

variable "lambda_artifacts_prefix" {
  description = "S3 prefix for Lambda artifacts."
  type        = string
  default     = "lambdas"
}

variable "lambda_artifact_keys" {
  description = "Optional per-lambda mapping to full S3 zip key."
  type        = map(string)
  default     = {}
}

variable "lambda_artifact_hashes" {
  description = "Optional per-lambda mapping with zip base64sha256 hash."
  type        = map(string)
  default     = {}
}

variable "logs_retention_in_days" {
  description = "CloudWatch logs retention in days."
  type        = number
  default     = 30
}

variable "api_throttling_rate_limit" {
  description = "Steady-state request rate (requests/second) allowed on the upload API's default stage before API Gateway starts returning 429s."
  type        = number
  default     = 25
}

variable "api_throttling_burst_limit" {
  description = "Burst capacity (concurrent requests) allowed on the upload API's default stage."
  type        = number
  default     = 50
}

variable "enable_budget_alarm" {
  description = "Create an AWS Budgets monthly cost alarm. Only takes effect in cloud mode (LocalStack has no Budgets API) and when budget_alert_email is set."
  type        = bool
  default     = true
}

variable "monthly_budget_usd" {
  description = "Monthly cost threshold (USD) that triggers the AWS Budgets alarm."
  type        = number
  default     = 10
}

variable "budget_alert_email" {
  description = "Email address notified when monthly_budget_usd is forecast/exceeded. Leave empty to skip creating the budget."
  type        = string
  default     = ""
}

variable "lambda_reserved_concurrency_enabled" {
  description = "Apply each function's reserved_concurrency from locals.lambda_config (65 in total). Turn off on accounts whose Lambda concurrency quota is still the new-account default of 10, where any reservation fails (AWS keeps 10 unreserved)."
  type        = bool
  default     = true
}
