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

variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "documents_bucket_force_destroy" {
  description = "Allow destroying bucket with objects."
  type        = bool
  default     = true
}

variable "lambda_artifacts_bucket" {
  description = "S3 bucket where Lambda zip artifacts are published by the pipeline."
  type        = string
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
