# One-time, account-level setup for the CI/CD deploy job and the Destroy workflow (see
# "Cloud Deployment" in README.md). Applied manually, once, with your own admin credentials:
#
#   cd infra/bootstrap && terraform init && terraform apply
#
# It creates what the pipeline needs *before* it can run:
#   - an S3 bucket for the main stack's remote state (native S3 locking, no DynamoDB table)
#   - an S3 bucket for the Lambda zip artifacts the pipeline publishes (lambda_artifacts_bucket)
#   - the GitHub Actions OIDC identity provider (optional, an account can only have one)
#   - an IAM role the pipeline assumes via OIDC, so no long-lived AWS keys live in GitHub
#
# This directory keeps its own local state (gitignored): a handful of resources that rarely
# change, and it can't store its state in the bucket it creates.

terraform {
  required_version = ">= 1.12.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

locals {
  account_id       = data.aws_caller_identity.current.account_id
  state_bucket     = "${var.repository_name}-tfstate-${local.account_id}"
  artifacts_bucket = "${var.repository_name}-artifacts-${local.account_id}"
  oidc_host        = "token.actions.githubusercontent.com"

  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${local.account_id}:oidc-provider/${local.oidc_host}"

  github_owner = split("/", var.github_repository)[0]
  github_repo  = split("/", var.github_repository)[1]

  # GitHub may send the subject in either format: the classic name-based one, or the
  # immutable one that embeds owner/repo IDs.
  github_oidc_subjects = flatten([
    for env in var.github_environments : [
      "repo:${var.github_repository}:environment:${env}",
      "repo:${local.github_owner}@${var.github_owner_id}/${local.github_repo}@${var.github_repository_id}:environment:${env}",
    ]
  ])

  tags = {
    Project   = var.repository_name
    ManagedBy = "Terraform"
  }
}

# --- Buckets -----------------------------------------------------------------------------

resource "aws_s3_bucket" "tfstate" {
  bucket = local.state_bucket
  tags   = local.tags
}

resource "aws_s3_bucket" "artifacts" {
  bucket = local.artifacts_bucket
  tags   = local.tags
}

locals {
  bootstrap_buckets = {
    tfstate   = aws_s3_bucket.tfstate.id
    artifacts = aws_s3_bucket.artifacts.id
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = local.bootstrap_buckets
  bucket   = each.value

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.bootstrap_buckets
  bucket   = each.value

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each = local.bootstrap_buckets
  bucket   = each.value

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# State keeps 90 days of history; artifacts are per-commit zips, so old ones (and their
# noncurrent versions) expire after 30 days.
resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-old-artifacts"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
}

# --- GitHub OIDC -------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
  tags           = local.tags
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = local.github_oidc_subjects
    }
  }
}

# Named after the repository, deliberately outside the stack's "${var.project_name}-"
# prefix, so none of the prefix-scoped IAM permissions below can touch this role itself.
resource "aws_iam_role" "github_deploy" {
  name                 = "${var.repository_name}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
  tags                 = local.tags
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${var.repository_name}-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.deploy_permissions.json
}
