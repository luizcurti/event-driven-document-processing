variable "project_name" {
  description = "Nome base do projeto."
  type        = string
  default     = "document-processing-platform"
}

variable "environment" {
  description = "Ambiente de deploy."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "Regiao AWS."
  type        = string
  default     = "us-east-1"
}

variable "documents_bucket_force_destroy" {
  description = "Permite destruir bucket com objetos."
  type        = bool
  default     = true
}

variable "lambda_artifacts_bucket" {
  description = "Bucket S3 onde os zips das Lambdas sao publicados pelo pipeline."
  type        = string
}

variable "lambda_artifacts_prefix" {
  description = "Prefixo S3 para artefatos de Lambda."
  type        = string
  default     = "lambdas"
}

variable "lambda_artifact_keys" {
  description = "Mapeamento opcional por lambda para chave S3 completa do zip."
  type        = map(string)
  default     = {}
}

variable "lambda_artifact_hashes" {
  description = "Mapeamento opcional por lambda com hash base64sha256 do zip."
  type        = map(string)
  default     = {}
}

variable "logs_retention_in_days" {
  description = "Retencao de logs no CloudWatch."
  type        = number
  default     = 30
}
