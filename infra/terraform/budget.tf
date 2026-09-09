# Cost guardrail for cloud deployments: LocalStack has no Budgets API, and Step
# Functions bills per state transition, so a runaway loop could otherwise run up a real
# bill unnoticed until the next invoice. Tracks total account spend rather than
# filtering by this project's tag, since AWS Budgets' cost_filter tag syntax is brittle
# and this repo is meant to run in its own throwaway/sandbox account anyway.
resource "aws_budgets_budget" "monthly_cost" {
  count        = var.enable_budget_alarm && var.deployment_mode == "cloud" && var.budget_alert_email != "" ? 1 : 0
  name         = "${local.name_prefix}-monthly-budget"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
