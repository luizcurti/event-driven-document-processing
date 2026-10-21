resource "aws_apigatewayv2_api" "upload_api" {
  count         = var.enable_api_gateway ? 1 : 0
  name          = "${local.name_prefix}-upload-api"
  protocol_type = "HTTP"

  tags = local.tags
}

resource "aws_apigatewayv2_integration" "upload_lambda" {
  count                  = var.enable_api_gateway ? 1 : 0
  api_id                 = aws_apigatewayv2_api.upload_api[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.this["upload"].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "get_document_lambda" {
  count                  = var.enable_api_gateway ? 1 : 0
  api_id                 = aws_apigatewayv2_api.upload_api[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.this["get_document"].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "upload" {
  count              = var.enable_api_gateway ? 1 : 0
  api_id             = aws_apigatewayv2_api.upload_api[0].id
  route_key          = "POST /documents"
  target             = "integrations/${aws_apigatewayv2_integration.upload_lambda[0].id}"
  authorization_type = "AWS_IAM"
}

resource "aws_apigatewayv2_route" "get_document" {
  count              = var.enable_api_gateway ? 1 : 0
  api_id             = aws_apigatewayv2_api.upload_api[0].id
  route_key          = "GET /documents/{documentId}"
  target             = "integrations/${aws_apigatewayv2_integration.get_document_lambda[0].id}"
  authorization_type = "AWS_IAM"
}

resource "aws_apigatewayv2_stage" "default" {
  count       = var.enable_api_gateway ? 1 : 0
  api_id      = aws_apigatewayv2_api.upload_api[0].id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.api_throttling_rate_limit
    throttling_burst_limit = var.api_throttling_burst_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway_logs[0].arn
    format = jsonencode({
      requestId = "$context.requestId"
      routeKey  = "$context.routeKey"
      status    = "$context.status"
      ip        = "$context.identity.sourceIp"
    })
  }
}

resource "aws_lambda_permission" "allow_api_gateway_upload" {
  count         = var.enable_api_gateway ? 1 : 0
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this["upload"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.upload_api[0].execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_api_gateway_get_document" {
  count         = var.enable_api_gateway ? 1 : 0
  statement_id  = "AllowExecutionFromApiGatewayGetDocument"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this["get_document"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.upload_api[0].execution_arn}/*/*"
}

resource "aws_cloudwatch_log_group" "api_gateway_logs" {
  count             = var.enable_api_gateway ? 1 : 0
  name              = "/aws/apigateway/${local.name_prefix}-upload-api"
  retention_in_days = var.logs_retention_in_days
  kms_key_id        = aws_kms_key.platform.arn
  tags              = local.tags
}

resource "aws_wafv2_web_acl" "api_waf" {
  count       = var.enable_waf && var.enable_api_gateway ? 1 : 0
  name        = "${local.name_prefix}-waf"
  scope       = "REGIONAL"
  description = "WAF for the upload API"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common-rule-set"
      sampled_requests_enabled   = true
    }
  }

  # Blocks common SQL injection payloads in the request body/query string/headers.
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "sqli-rule-set"
      sampled_requests_enabled   = true
    }
  }

  # Blocks request patterns known to exploit specific software (e.g. Log4j-style
  # payloads), distinct from the generic OWASP coverage in the Common Rule Set.
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "known-bad-inputs-rule-set"
      sampled_requests_enabled   = true
    }
  }

  # Rate limiting: blocks a single IP once it crosses the configured request budget in
  # any trailing 5-minute window.
  rule {
    name     = "RateLimitPerIp"
    priority = 4

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "upload-api-waf"
    sampled_requests_enabled   = true
  }

  tags = local.tags
}

resource "aws_wafv2_web_acl_association" "api_association" {
  count        = var.enable_waf && var.enable_api_gateway ? 1 : 0
  resource_arn = aws_apigatewayv2_stage.default[0].arn
  web_acl_arn  = aws_wafv2_web_acl.api_waf[0].arn
}

# Name must start with "aws-waf-logs-" — WAFv2 rejects any other CloudWatch log
# group as a logging destination.
resource "aws_cloudwatch_log_group" "waf" {
  count             = var.enable_waf && var.enable_api_gateway ? 1 : 0
  name              = "aws-waf-logs-${local.name_prefix}"
  retention_in_days = var.logs_retention_in_days
  kms_key_id        = aws_kms_key.platform.arn
  tags              = local.tags
}

resource "aws_wafv2_web_acl_logging_configuration" "api_waf" {
  count                   = var.enable_waf && var.enable_api_gateway ? 1 : 0
  resource_arn            = aws_wafv2_web_acl.api_waf[0].arn
  log_destination_configs = [aws_cloudwatch_log_group.waf[0].arn]
}
