terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  access_key = var.deployment_mode == "local" ? "test" : null
  secret_key = var.deployment_mode == "local" ? "test" : null

  skip_credentials_validation = var.deployment_mode == "local"
  skip_metadata_api_check     = var.deployment_mode == "local"
  skip_requesting_account_id  = var.deployment_mode == "local"
  s3_use_path_style           = var.deployment_mode == "local"

  dynamic "endpoints" {
    for_each = var.deployment_mode == "local" ? [1] : []

    content {
      apigatewayv2     = var.localstack_endpoint
      cloudwatch       = var.localstack_endpoint
      cloudwatchevents = var.localstack_endpoint
      cloudwatchlogs   = var.localstack_endpoint
      dynamodb         = var.localstack_endpoint
      iam              = var.localstack_endpoint
      kms              = var.localstack_endpoint
      lambda           = var.localstack_endpoint
      s3               = var.localstack_endpoint
      sfn              = var.localstack_endpoint
      sns              = var.localstack_endpoint
      sqs              = var.localstack_endpoint
      ssm              = var.localstack_endpoint
      sts              = var.localstack_endpoint
      wafv2            = var.localstack_endpoint
    }
  }
}
