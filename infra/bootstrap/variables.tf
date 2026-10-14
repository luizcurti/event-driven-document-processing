variable "aws_region" {
  description = "Region the stack is deployed to. Must match the AWS_REGION variable of the GitHub environment and aws_region in infra/terraform/environments/*.tfvars."
  type        = string
  default     = "eu-west-2"
}

variable "project_name" {
  description = "Must match project_name in infra/terraform/environments/*.tfvars: the deploy role's permissions are scoped by this prefix."
  type        = string
  default     = "document-processing-platform"
}

variable "repository_name" {
  description = "Prefix for the bootstrap's own resources (state and artifacts buckets, deploy role). Deliberately different from project_name, so the deploy role's prefix-scoped permissions can't reach them."
  type        = string
  default     = "event-driven-document-processing"
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role."
  type        = string
  default     = "luizcurti/event-driven-document-processing"
}

variable "github_owner_id" {
  description = "Numeric GitHub ID of the repository owner, used in GitHub's immutable OIDC subject format (gh api repos/OWNER/REPO --jq .owner.id)."
  type        = number
  default     = 9360461
}

variable "github_repository_id" {
  description = "Numeric GitHub ID of the repository, used in GitHub's immutable OIDC subject format (gh api repos/OWNER/REPO --jq .id)."
  type        = number
  default     = 1305168764
}

variable "github_environments" {
  description = "GitHub environments whose jobs may assume the deploy role."
  type        = list(string)
  default     = ["dev"]
}

variable "create_oidc_provider" {
  description = "Create the token.actions.githubusercontent.com OIDC provider. Set to false if the AWS account already has it (an account can only have one)."
  type        = bool
  default     = true
}
