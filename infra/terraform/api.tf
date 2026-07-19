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
  description = "WAF para API de upload"

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
