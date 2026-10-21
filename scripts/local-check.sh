#!/usr/bin/env bash

set -euo pipefail

AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://127.0.0.1:4566}"
AWS_REGION="${AWS_REGION:-us-east-1}"
RESOURCE_PREFIX="${RESOURCE_PREFIX:-document-processing-platform-local}"
DDB_SCAN_LIMIT="${DDB_SCAN_LIMIT:-5}"
S3_LIST_LIMIT="${S3_LIST_LIMIT:-5}"

export AWS_PAGER=""
AWS_CMD=(aws --no-cli-pager --endpoint-url="$AWS_ENDPOINT_URL" --region "$AWS_REGION")

section() {
  echo
  echo "========================================"
  echo "$1"
  echo "========================================"
}

line() {
  echo "- $1"
}

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: AWS CLI not found in PATH."
  exit 1
fi

section "LocalStack Health"
if command -v curl >/dev/null 2>&1; then
  if curl -fsS "$AWS_ENDPOINT_URL/_localstack/health" >/tmp/localstack-health.json 2>/dev/null; then
    line "Endpoint: $AWS_ENDPOINT_URL"
    line "Region: $AWS_REGION"
    line "Health: OK"
  else
    line "Endpoint: $AWS_ENDPOINT_URL"
    line "Health: failed (LocalStack may be unavailable)"
  fi
else
  line "curl not found; skipping HTTP health check"
fi

section "DynamoDB Tables"
TABLES_RAW="$(${AWS_CMD[@]} dynamodb list-tables --query 'TableNames[]' --output text || true)"
if [[ -z "${TABLES_RAW// }" || "$TABLES_RAW" == "None" ]]; then
  line "No tables found"
else
  table_matches=0
  for table in $TABLES_RAW; do
    if [[ "$table" == "$RESOURCE_PREFIX"* ]]; then
      table_matches=$((table_matches + 1))
      line "Table: $table"
      COUNT="$(${AWS_CMD[@]} dynamodb scan --table-name "$table" --select COUNT --output text --query 'Count' || echo '?')"
      line "Items: $COUNT"
      line "Sample items (limit=$DDB_SCAN_LIMIT):"
      ${AWS_CMD[@]} dynamodb scan --table-name "$table" --limit "$DDB_SCAN_LIMIT" --output table || true
    fi
  done
  if [[ "$table_matches" -eq 0 ]]; then
    line "No tables found with prefix: $RESOURCE_PREFIX"
  fi
fi

section "SQS Queues"
QUEUES_RAW="$(${AWS_CMD[@]} sqs list-queues --query 'QueueUrls[]' --output text || true)"
if [[ -z "${QUEUES_RAW// }" || "$QUEUES_RAW" == "None" ]]; then
  line "No queues found"
else
  queue_matches=0
  for queue_url in $QUEUES_RAW; do
    queue_name="${queue_url##*/}"
    if [[ "$queue_name" == "$RESOURCE_PREFIX"* ]]; then
      queue_matches=$((queue_matches + 1))
      line "Queue: $queue_name"
      ${AWS_CMD[@]} sqs get-queue-attributes \
        --queue-url "$queue_url" \
        --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible CreatedTimestamp \
        --output table || true
    fi
  done
  if [[ "$queue_matches" -eq 0 ]]; then
    line "No queues found with prefix: $RESOURCE_PREFIX"
  fi
fi

section "S3 Buckets"
BUCKETS_RAW="$(${AWS_CMD[@]} s3api list-buckets --query 'Buckets[].Name' --output text || true)"
if [[ -z "${BUCKETS_RAW// }" || "$BUCKETS_RAW" == "None" ]]; then
  line "No buckets found"
else
  bucket_matches=0
  for bucket in $BUCKETS_RAW; do
    if [[ "$bucket" == "$RESOURCE_PREFIX"* ]]; then
      bucket_matches=$((bucket_matches + 1))
      line "Bucket: $bucket"
      ${AWS_CMD[@]} s3api list-objects-v2 --bucket "$bucket" --max-items "$S3_LIST_LIMIT" --output table || true
    fi
  done
  if [[ "$bucket_matches" -eq 0 ]]; then
    line "No buckets found with prefix: $RESOURCE_PREFIX"
  fi
fi

section "SNS Topics"
TOPICS_RAW="$(${AWS_CMD[@]} sns list-topics --query 'Topics[].TopicArn' --output text || true)"
if [[ -z "${TOPICS_RAW// }" || "$TOPICS_RAW" == "None" ]]; then
  line "No topics found"
else
  topic_matches=0
  for topic_arn in $TOPICS_RAW; do
    topic_name="${topic_arn##*:}"
    if [[ "$topic_name" == "$RESOURCE_PREFIX"* ]]; then
      topic_matches=$((topic_matches + 1))
      line "Topic: $topic_arn"
    fi
  done
  if [[ "$topic_matches" -eq 0 ]]; then
    line "No topics found with prefix: $RESOURCE_PREFIX"
  fi
fi

section "Lambda Functions"
LAMBDAS_RAW="$(${AWS_CMD[@]} lambda list-functions --query 'Functions[].FunctionName' --output text || true)"
if [[ -z "${LAMBDAS_RAW// }" || "$LAMBDAS_RAW" == "None" ]]; then
  line "No Lambda functions found"
else
  lambda_matches=0
  for fn in $LAMBDAS_RAW; do
    if [[ "$fn" == "$RESOURCE_PREFIX"* ]]; then
      lambda_matches=$((lambda_matches + 1))
      line "Lambda: $fn"
    fi
  done
  if [[ "$lambda_matches" -eq 0 ]]; then
    line "No Lambda functions found with prefix: $RESOURCE_PREFIX"
  fi
fi

echo
echo "Summary: verification completed."
echo "Tip: to inspect another environment, run with RESOURCE_PREFIX=<prefix>"