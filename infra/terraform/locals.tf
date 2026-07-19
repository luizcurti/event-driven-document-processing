locals {
  name_prefix = "${var.project_name}-${var.environment}"

  tags = {
    Project      = var.project_name
    Environment  = var.environment
    ManagedBy    = "Terraform"
    Architecture = "DDD-Clean-Hexagonal"
  }

  lambda_config = {
    upload = {
      handler = "functions/upload.handler"
      timeout = 30
    }
    get_document = {
      handler = "functions/get-document.handler"
      timeout = 15
    }
    start_workflow = {
      handler = "functions/start-workflow.handler"
      timeout = 30
    }
    ocr = {
      handler = "functions/ocr.handler"
      timeout = 60
    }
    thumbnail = {
      handler = "functions/thumbnail.handler"
      timeout = 60
    }
    validation = {
      handler = "functions/validation.handler"
      timeout = 30
    }
    merge_results = {
      handler = "functions/merge-results.handler"
      timeout = 30
    }
    metadata = {
      handler = "functions/metadata.handler"
      timeout = 30
    }
    notification = {
      handler = "functions/notification.handler"
      timeout = 30
    }
  }
}
