# Document Processing Platform

Serverless, event-driven PDF processing platform built with Node.js, TypeScript, Terraform, and AWS services.

## Architecture

Main flow:

1. `POST /documents` on API Gateway invokes the Upload Lambda.
2. The Upload Lambda validates the input, generates a `documentId`, saves the initial metadata in DynamoDB, and returns an `uploadUrl` (S3 presigned URL). The whole operation runs once per `requestId`/idempotency key via an atomic claim-and-cache pattern (see "Idempotency" below).
3. The client uploads the PDF to S3 using the `uploadUrl`.
4. The S3 `Object Created` event reaches EventBridge, which starts Step Functions (execution name = `documentId`) and also marks the document `PROCESSING` in DynamoDB.
5. Step Functions runs OCR, Thumbnail, and Validation in parallel.
   - OCR is genuinely asynchronous in cloud mode: the OCR Lambda calls `Textract.StartDocumentTextDetection` and returns immediately; a `waitForTaskToken` state pauses that branch. Textract publishes job completion to an SNS topic, which invokes a dedicated `ocr-callback` Lambda that fetches the result and resolves the task token (`SendTaskSuccess`/`SendTaskFailure`). In local mode (no Textract in LocalStack Community), the OCR Lambda resolves synchronously with a mock result instead.
   - Thumbnail writes real (placeholder, solid-color) PNG images to `thumbnails/{documentId}/page-1.png`, `page-2.png`, and `preview.png`. Pixel-accurate PDF rendering still requires the poppler/sharp/chromium container-image pipeline described in the spec — this placeholder produces genuine image artifacts at the right keys without that native-binary dependency.
6. Merge Results consolidates the data.
7. The Metadata Lambda persists the final result in DynamoDB and publishes an event to SQS.
8. The Notification Lambda consumes SQS and publishes to SNS.

Important: there is a single DynamoDB table for documents (`documents-metadata`), updated at several moments: initial creation (upload), `PROCESSING` (workflow start), and final result/failure (post-processing).

Diagram: `docs/diagram.png`

## Technologies

- Node.js + TypeScript
- AWS Lambda
- API Gateway
- S3
- EventBridge
- Step Functions
- Textract (async OCR)
- DynamoDB
- SQS + DLQ
- SNS
- CloudWatch
- KMS
- WAF (enabled in cloud; optional locally)
- Terraform

## Idempotency

Every event-consuming Lambda (Upload, OCR, Thumbnail, Validation, Notification) runs its
work through an atomic claim-and-cache helper (`withIdempotency`), backed by a single
conditional DynamoDB write — never a read-then-decide race:

1. Atomically claim the idempotency key (`PutItem` with `ConditionExpression:
   attribute_not_exists(pk)`, status `IN_PROGRESS`).
2. If the claim fails because the key already exists, read the existing record. If its
   status is `COMPLETED`, return the cached result without re-running the work. If it is
   still `IN_PROGRESS` (the original attempt crashed or is still running), fall through
   and actually run the work — this is what makes Step Functions/SQS retries after a
   real transient failure retry the operation, instead of returning a fabricated
   success.
3. On success, atomically mark the record `COMPLETED` with the result attached.

## IAM

Each Lambda has its own execution role, scoped in Terraform (`locals.lambda_iam_statements`)
to only the actions/resources that function needs — e.g. the OCR Lambda gets
`s3:GetObject`, never `s3:*`; `merge_results` (a pure function) gets no resource access
at all beyond CloudWatch Logs.

## Prerequisites

- Node.js 22+
- Docker + Docker Compose
- Terraform 1.12+

## Local Quick Start (LocalStack)

You can bootstrap the full local environment in one command:

```bash
npm run local:setup
```

This script installs dependencies when needed, packages the Lambdas, starts LocalStack, runs `terraform init`, and applies the local Terraform stack.

### 1. Install dependencies and package

```bash
npm install
npm run package:local
```

This generates `dist/lambda.zip` with all handlers.

### 2. Start LocalStack

```bash
npm run localstack:up
```

### 3. Apply Terraform in local mode

```bash
cd infra/terraform
terraform init -input=false
terraform apply -input=false -auto-approve -var-file=environments/local.tfvars
```

Equivalent one-shot shell script:

```bash
./scripts/local-up.sh
```

To tear down local resources:

```bash
npm run local:teardown
```

### 3.1 Verify local resources quickly (recruiter-friendly)

Run a single command to inspect the main LocalStack resources used by the project:

```bash
npm run local:check
```

This command checks:

- LocalStack health endpoint
- DynamoDB tables and item sample
- SQS queues and message counters
- S3 buckets and object sample
- SNS topics
- Lambda functions

Optional filters:

```bash
RESOURCE_PREFIX=document-processing-platform-local npm run local:check
AWS_REGION=us-east-1 AWS_ENDPOINT_URL=http://127.0.0.1:4566 npm run local:check
```

### 4. Start the upload flow locally

In LocalStack Community, `apigatewayv2` and parts of the Step Functions API may not be available.
For that reason, the following are disabled in `local.tfvars`:

- `enable_api_gateway = false`
- `enable_step_functions = false`

The upload and local processing flow must be validated by invoking the Lambdas directly.

Example event to invoke the upload Lambda:

```bash
cat > /tmp/upload-event.json <<'EOF'
{
  "version": "2.0",
  "routeKey": "POST /documents",
  "rawPath": "/documents",
  "headers": {
    "content-type": "application/json",
    "x-idempotency-key": "req-local-001"
  },
  "requestContext": {
    "requestId": "req-local-001"
  },
  "body": "{\"fileName\":\"contract.pdf\",\"contentType\":\"application/pdf\"}"
}
EOF

aws --endpoint-url=http://127.0.0.1:4566 lambda invoke \
  --function-name document-processing-platform-local-upload \
  --payload fileb:///tmp/upload-event.json \
  /tmp/upload-response.json && cat /tmp/upload-response.json
```

### 5. Upload to S3 using the uploadUrl

Expected Lambda response body:

```json
{
  "documentId": "...",
  "uploadUrl": "...",
  "key": "..."
}
```

### 6. Send the file to S3 with the uploadUrl

```bash
curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: application/pdf" \
  --data-binary @./contract.pdf
```

In cloud, the rest of the flow is asynchronous after the upload (EventBridge -> Step Functions -> Lambdas -> DynamoDB/SQS/SNS).
In LocalStack Community, use the manual fallback in step 7.

In cloud, API routes use `AWS_IAM` authentication.

Additional status endpoint:

- `GET /documents/{documentId}`

### 7. Run the manual pipeline locally (fallback without Step Functions)

Use the `documentId`, `bucket`, and `key` from the upload response:

```bash
cat > /tmp/processing-request.json <<'EOF'
{
  "documentId": "YOUR_DOCUMENT_ID",
  "bucket": "document-processing-platform-local-documents",
  "key": "YOUR_DOCUMENT_ID/contract.pdf"
}
EOF

aws --endpoint-url=http://127.0.0.1:4566 lambda invoke --function-name document-processing-platform-local-ocr --payload fileb:///tmp/processing-request.json /tmp/ocr.json && cat /tmp/ocr.json
aws --endpoint-url=http://127.0.0.1:4566 lambda invoke --function-name document-processing-platform-local-thumbnail --payload fileb:///tmp/processing-request.json /tmp/thumbnail.json && cat /tmp/thumbnail.json
aws --endpoint-url=http://127.0.0.1:4566 lambda invoke --function-name document-processing-platform-local-validation --payload fileb:///tmp/processing-request.json /tmp/validation.json && cat /tmp/validation.json
```

Build the merge payload and execute it:

```bash
cat > /tmp/merge-event.json <<'EOF'
{
  "documentId": "YOUR_DOCUMENT_ID",
  "ocr": {"textPreview": "mock", "confidence": 0.99},
  "thumbnail": {"thumbnailKey": "thumbnails/YOUR_DOCUMENT_ID.json", "width": 320, "height": 200},
  "validation": {"valid": true, "reasons": []}
}
EOF

aws --endpoint-url=http://127.0.0.1:4566 lambda invoke --function-name document-processing-platform-local-merge_results --payload fileb:///tmp/merge-event.json /tmp/merged.json && cat /tmp/merged.json
aws --endpoint-url=http://127.0.0.1:4566 lambda invoke --function-name document-processing-platform-local-metadata --payload fileb:///tmp/merged.json /tmp/metadata.json && cat /tmp/metadata.json
```

The notification Lambda consumes messages automatically from SQS via event source mapping.

## Postman

The repository includes Postman assets under [postman](postman) for both cloud-oriented HTTP testing and the current local-only workflow.

Available files:

- [postman/document-processing-platform.postman_collection.json](postman/document-processing-platform.postman_collection.json): API Gateway oriented collection for a real AWS HTTP endpoint.
- [postman/document-processing-platform-local.postman_collection.json](postman/document-processing-platform-local.postman_collection.json): LocalStack collection that invokes Lambdas directly through the Lambda API.
- [postman/document-processing-platform-local.postman_environment.json](postman/document-processing-platform-local.postman_environment.json): Local environment with LocalStack endpoint, test credentials, Lambda names, and the bundled sample PDF path.
- [postman/contract.pdf](postman/contract.pdf): Sample PDF file used by the upload step.

### Local Postman flow

Because `enable_api_gateway = false` in local mode, the local collection does not call `POST /documents` over HTTP. Instead, it invokes the deployed Lambdas in LocalStack directly.

Recommended order:

1. Import the local collection and local environment.
2. Start LocalStack and apply Terraform locally with `npm run local:setup` or `./scripts/local-up.sh`.
3. Run `1. Invoke Upload Lambda`.
4. Run `2. Upload PDF To Presigned URL`.
5. Run `3. Invoke OCR Lambda`.
6. Run `4. Invoke Thumbnail Lambda`.
7. Run `5. Invoke Validation Lambda`.
8. Run `6. Invoke Merge Results Lambda`.
9. Run `7. Invoke Metadata Lambda`.
10. Run `8. Invoke Get Document Status Lambda`.

The collection automatically stores `documentId`, `uploadUrl`, `uploadKey`, and intermediate processing results as collection variables.

## Lambda Environment Variables

The Lambdas receive the following values via Terraform:

- `DOCUMENTS_BUCKET`
- `DOCUMENTS_METADATA_TABLE`
- `NOTIFICATION_QUEUE_URL`
- `NOTIFICATION_TOPIC_ARN`
- `AWS_EXECUTION_MODE` (`cloud` or `local`)
- `AWS_ENDPOINT_URL` (local only)
- `TEXTRACT_ROLE_ARN`, `TEXTRACT_TOPIC_ARN` (OCR Lambda only — used to start the async Textract job with an SNS completion notification)

## Cloud Deployment

Use `environments/dev.tfvars` or `environments/prod.tfvars` with:

- `deployment_mode = "cloud"`
- `lambda_artifacts_bucket` configured
- `lambda_artifacts_prefix` configured
- `thumbnail_lambda_image_uri` configured to use the Thumbnail Lambda as a container image

Commands:

```bash
cd infra/terraform
terraform init -input=false
terraform plan -var-file=environments/dev.tfvars
terraform apply -input=false -var-file=environments/dev.tfvars
```

## Tests and Quality

```bash
npm run check
npm run lint
npm run test
npm run test:coverage
```

CI (`.github/workflows/ci.yml`) also runs `terraform fmt -check` and `terraform validate`
on every push/PR. It does not run `terraform plan`/`apply`, since that needs
environment-specific AWS credentials this repo doesn't provision.

Coverage target:

- 100% for lines, functions, branches, and statements, enforced on
  `src/contexts/**/application/use-cases/*.ts` and the idempotency adapter
  (`aws-dynamo-idempotency-service.ts`) — the use-case layer and the atomic
  claim/cache logic behind every idempotency guarantee in the system. The Lambda
  handlers in `src/functions/` and the AWS adapters are exercised by the local
  integration flow (`npm run test:integration:local`) and the Postman/Newman
  collection, but are not yet part of the enforced unit-coverage set.

## Project Notes

- Upload idempotency prefers the `x-idempotency-key` header (the actual client-supplied
  retry key) over `requestContext.requestId` (which is unique per HTTP request in a real
  API Gateway deployment, so it can't dedupe client retries on its own). Both are wrapped
  in the same atomic claim-and-cache flow described above: a genuine duplicate request
  gets the original cached response back (`200`), not a `409`.
- Step Functions retries only transient errors (`Lambda.ServiceException`, `Lambda.TooManyRequestsException`, `States.Timeout`).
- The notification queue has a DLQ configured with `maxReceiveCount = 3`.
- The notification queue visibility timeout is set to 120 seconds.
- In local mode, OCR uses a mock fallback to avoid unsupported service dependencies (LocalStack Community has no Textract support). In cloud mode, OCR is genuinely asynchronous — see "Architecture" above.
- The local presigned upload URL uses the `localhost.localstack.cloud` hostname, which resolves via public DNS to `127.0.0.1`. In network-restricted environments (offline dev, some CI runners/sandboxes) that lookup can fail even though LocalStack itself is reachable on `127.0.0.1:4566` — if `PUT` to the presigned URL fails with a DNS error, add a hosts-file entry (or an equivalent DNS override) for that hostname rather than assuming LocalStack is down.

Local default endpoint: `http://127.0.0.1:4566`. To test with a real HTTP API, run in AWS (`deployment_mode = "cloud"`) or use a LocalStack edition with `apigatewayv2` support.