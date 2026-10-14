# What infra/terraform creates, updates and destroys, scoped to resources named with the
# "${var.project_name}-" prefix wherever the service supports resource-level permissions.
#
# Unavoidably broader:
#   - API Gateway APIs and WAF associations are addressed by generated IDs, so they're
#     scoped to the region rather than the project.
#   - KMS keys are addressed by generated IDs, so they're scoped by the stack's
#     Project tag (set on the key at creation) instead.
#   - Lambda event source mappings are addressed by UUID.
#   - A handful of Describe/List/log-delivery calls only accept "*".

locals {
  p    = var.project_name
  rgn  = var.aws_region
  acct = local.account_id
}

data "aws_iam_policy_document" "deploy_permissions" {
  statement {
    sid       = "BootstrapBucketsList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.tfstate.arn, aws_s3_bucket.artifacts.arn]
  }

  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.tfstate.arn}/*"]
  }

  # The pipeline uploads the zips; Lambda's CreateFunction/UpdateFunctionCode then reads
  # them with the caller's permissions.
  statement {
    sid       = "ArtifactObjects"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }

  statement {
    sid     = "StackBuckets"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${local.p}-*",
      "arn:aws:s3:::${local.p}-*/*",
    ]
  }

  statement {
    sid       = "LambdaFunctions"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${local.rgn}:${local.acct}:function:${local.p}-*"]
  }

  statement {
    sid = "LambdaEventSourceMappings"
    actions = [
      "lambda:CreateEventSourceMapping",
      "lambda:GetEventSourceMapping",
      "lambda:UpdateEventSourceMapping",
      "lambda:DeleteEventSourceMapping",
      "lambda:ListEventSourceMappings",
      "lambda:TagResource",
      "lambda:ListTags",
    ]
    resources = ["*"]
  }

  statement {
    sid = "IamProjectRoles"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRoleTags",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = ["arn:aws:iam::${local.acct}:role/${local.p}-*"]
  }

  # Only the two AWS-managed policies the stack attaches (iam.tf), so the deploy role
  # can't hand AdministratorAccess to a role it creates.
  statement {
    sid       = "IamAttachStackManagedPoliciesOnly"
    actions   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
    resources = ["arn:aws:iam::${local.acct}:role/${local.p}-*"]

    condition {
      test     = "ArnEquals"
      variable = "iam:PolicyARN"
      values = [
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess",
      ]
    }
  }

  statement {
    sid       = "IamPassStackRoles"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.acct}:role/${local.p}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "states.amazonaws.com"]
    }
  }

  statement {
    sid       = "StepFunctions"
    actions   = ["states:*"]
    resources = ["arn:aws:states:${local.rgn}:${local.acct}:stateMachine:${local.p}-*"]
  }

  # The provider validates the ASL before Create/UpdateStateMachine; AWS authorizes this
  # call against stateMachine:* rather than the machine's own name.
  statement {
    sid       = "StepFunctionsValidateDefinition"
    actions   = ["states:ValidateStateMachineDefinition"]
    resources = ["arn:aws:states:${local.rgn}:${local.acct}:stateMachine:*"]
  }

  statement {
    sid = "ApiGateway"
    actions = [
      "apigateway:GET",
      "apigateway:POST",
      "apigateway:PUT",
      "apigateway:PATCH",
      "apigateway:DELETE",
      "apigateway:TagResource",
      "apigateway:UntagResource",
      "apigateway:SetWebACL",
    ]
    resources = ["arn:aws:apigateway:${local.rgn}::/*"]
  }

  statement {
    sid       = "Waf"
    actions   = ["wafv2:*"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [local.rgn]
    }
  }

  statement {
    sid       = "DynamoDb"
    actions   = ["dynamodb:*"]
    resources = ["arn:aws:dynamodb:${local.rgn}:${local.acct}:table/${local.p}-*"]
  }

  statement {
    sid       = "Sqs"
    actions   = ["sqs:*"]
    resources = ["arn:aws:sqs:${local.rgn}:${local.acct}:${local.p}-*"]
  }

  statement {
    sid       = "Sns"
    actions   = ["sns:*"]
    resources = ["arn:aws:sns:${local.rgn}:${local.acct}:${local.p}-*"]
  }

  # Rules live on the default event bus.
  statement {
    sid       = "EventBridgeRules"
    actions   = ["events:*"]
    resources = ["arn:aws:events:${local.rgn}:${local.acct}:rule/${local.p}-*"]
  }

  statement {
    sid     = "LogGroups"
    actions = ["logs:*"]
    resources = [
      "arn:aws:logs:${local.rgn}:${local.acct}:log-group:/aws/lambda/${local.p}-*",
      "arn:aws:logs:${local.rgn}:${local.acct}:log-group:/aws/apigateway/${local.p}-*",
      "arn:aws:logs:${local.rgn}:${local.acct}:log-group:/aws/vendedlogs/states/${local.p}-*",
      "arn:aws:logs:${local.rgn}:${local.acct}:log-group:aws-waf-logs-${local.p}*",
    ]
  }

  statement {
    sid       = "Alarms"
    actions   = ["cloudwatch:*"]
    resources = ["arn:aws:cloudwatch:${local.rgn}:${local.acct}:alarm:${local.p}-*"]
  }

  # The stack's customer-managed KMS key (security.tf) has a generated ID, so it's
  # matched by the Project tag the stack sets on it instead of by name.
  statement {
    sid       = "KmsCreateTaggedKey"
    actions   = ["kms:CreateKey", "kms:TagResource"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Project"
      values   = [var.project_name]
    }
  }

  statement {
    sid = "KmsStackKey"
    actions = [
      "kms:DescribeKey",
      "kms:GetKeyPolicy",
      "kms:PutKeyPolicy",
      "kms:GetKeyRotationStatus",
      "kms:EnableKeyRotation",
      "kms:DisableKeyRotation",
      "kms:ListResourceTags",
      "kms:TagResource",
      "kms:UntagResource",
      "kms:UpdateKeyDescription",
      "kms:ScheduleKeyDeletion",
      "kms:CreateAlias",
      "kms:DeleteAlias",
      "kms:UpdateAlias",
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:CreateGrant",
      "kms:ListGrants",
      "kms:RetireGrant",
    ]
    resources = ["arn:aws:kms:${local.rgn}:${local.acct}:key/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.project_name]
    }
  }

  statement {
    sid       = "KmsStackAlias"
    actions   = ["kms:CreateAlias", "kms:DeleteAlias", "kms:UpdateAlias"]
    resources = ["arn:aws:kms:${local.rgn}:${local.acct}:alias/${local.p}-*"]
  }

  statement {
    sid = "AccountWideReadsAndLogDelivery"
    actions = [
      "sts:GetCallerIdentity",
      "kms:ListAliases",
      "cloudwatch:DescribeAlarms",
      "logs:DescribeLogGroups",
      "logs:DescribeResourcePolicies",
      "logs:PutResourcePolicy",
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "lambda:GetAccountSettings",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
    ]
    resources = ["*"]
  }
}
