# Document Processing Platform

## Goal

Build a serverless, event-driven document processing platform that accepts PDF uploads, processes them asynchronously, and produces derived metadata and notifications.

## Reference Flow

User uploads a document:

`contract.pdf`

System flow:

Upload

↓

S3

↓

EventBridge

↓

Step Functions (execution name = `documentId`, which prevents duplicate processing for duplicate S3 events)

↓

OCR Lambda + Thumbnail Lambda + Validation Lambda

↓

Merge Results

↓

Metadata Update

↓

Notification

↓

CloudWatch

## Architectural Goals

- Event-driven architecture
- Serverless architecture
- Workflow orchestration
- Fan-out processing
- Selective retry strategy
- Dead letter queue
- Atomic idempotency
- Observability
- Infrastructure as code
- Security best practices

## Required Stack

### Backend

- TypeScript
- Node.js
- AWS Lambda

### Infrastructure

Terraform must create:

- API Gateway
- Lambda
- S3
- EventBridge
- Step Functions
- DynamoDB
- SQS
- SNS
- CloudWatch
- IAM
- KMS
- WAF
- Cognito

## Architecture

```
Internet
   |
AWS WAF
   |
API Gateway (Cognito Authorizer)
   |
Upload Lambda
   |
+----------+----------+
|                     |
DynamoDB Metadata     S3 Bucket
|                     |
Object Created Event  |
|                     |
EventBridge           |
|                     |
Step Functions        |
|                     |
OCR Lambda        Thumbnail Lambda        Validation Lambda
(async Textract        |                        |
 + SNS + task token)    |                        |
|                      |                        |
+-----------+----------+------------------------+
            |
       Merge Results
            |
       Metadata Lambda
            |
       DynamoDB Update
            |
            SQS
            |
     Notification Lambda
            |
      CloudWatch Logs
```

If any branch fails (Catch):

- write `FAILED` to DynamoDB
- emit an EventBridge `Execution Status Change = FAILED` rule
- trigger a CloudWatch Alarm

Note: DynamoDB "Metadata" (initial write) and DynamoDB "Update" (post-merge) are the same `documents` table, updated at two different moments in the flow, not two separate tables.

## End-to-End Flow

### 1. Upload

User calls:

`POST /documents`

Authentication is mandatory via Cognito Authorizer, or at minimum API Key + IAM, configured in API Gateway. This endpoint must not be public.

Request:

```json
{
  "fileName": "contract.pdf",
  "contentType": "application/pdf"
}
```

Response:

```json
{
  "documentId": "uuid",
  "uploadUrl": "presigned-url"
}
```

The system must use an S3 presigned URL so large files do not go through Lambda.

### 1.1 Status lookup

Add:

`GET /documents/{documentId}`

Return the current DynamoDB record (status, timestamps, errors if present) so the client can track asynchronous progress.

### 2. Upload to S3

Bucket:

`document-processing-${environment}`

Enable:

- Versioning
- Encryption
- Logging

Encryption:

- AWS KMS customer-managed key

### 3. S3 Event

When a file arrives:

S3 event:

`ObjectCreated`

Send to:

EventBridge

Event:

```json
{
  "type": "DocumentUploaded",
  "documentId": "123",
  "bucket": "documents",
  "key": "uploads/file.pdf"
}
```

When starting the Step Functions execution from this event, use `documentId` as the execution `name` (`StartExecution`). Step Functions rejects duplicate execution names for 90 days, which avoids duplicate workflows for the same document if the S3 event is duplicated. No extra deduplication logic is required at this layer.

### 4. Step Functions

Create a state machine with this flow:

Start -> OCR -> Thumbnail -> Validation -> Parallel Success -> Merge Results -> Save Metadata -> Send Notification -> End

### Step Functions Requirements

Selective retry is mandatory.

Retry only transient/infrastructure errors, never business errors such as invalid or corrupted files. Those must go directly to Catch without retry:

```json
{
  "Retry": [
    {
      "ErrorEquals": [
        "Lambda.ServiceException",
        "Lambda.TooManyRequestsException",
        "States.Timeout"
      ],
      "MaxAttempts": 3,
      "BackoffRate": 2
    }
  ]
}
```

Business validation errors must be raised as a custom error such as `ValidationError`, not included in `ErrorEquals`, so they go straight to Catch.

Catch behavior:

1. Write `status: FAILED` to DynamoDB before transitioning to the Fail state.
2. Transition to Fail.

Additionally, create an EventBridge rule for `Step Functions Execution Status Change = FAILED` to trigger a CloudWatch Alarm. That covers workflow-level failures separately from the notification queue DLQ.

## Lambda Functions

### upload-document-lambda

Responsibilities:

- validate file input
- create documentId
- generate presigned URL
- save initial metadata

Must not:

- process the document
- perform OCR

### OCR Lambda

Input:

```json
{
  "bucket": "documents",
  "key": "file.pdf"
}
```

Implementation requirement:

Do not run OCR synchronously inside the Lambda; the 15-minute Lambda limit does not scale for large or multi-page PDFs. Instead:

1. The Lambda starts `Textract.StartDocumentTextDetection` asynchronously and returns.
2. SNS is configured to notify when the Textract job finishes.
3. The OCR state in Step Functions should use `waitForTaskToken`, releasing the token when SNS confirms completion.

Output after the job completes:

```json
{
  "text": "document content",
  "pages": 10
}
```

### Thumbnail Lambda

Responsibilities:

- generate `page-1.png`
- generate `page-2.png`
- generate `preview.png`
- save to S3 under `/thumbnails`

Implementation:

Thumbnail generation depends on native binaries such as poppler, sharp, or headless chromium, which do not work well in a standard Lambda zip package. Package this Lambda as a container image (Lambda + ECR), or use a tested Layer with `poppler-utils`.

### Validation Lambda

Validate:

- file type
- file size
- corrupted document
- required fields

Response:

```json
{
  "valid": true
}
```

### Merge Results Lambda

Responsibilities:

- combine OCR:

```json
{ "text": "..." }
```

- combine Thumbnail:

```json
{ "images": [] }
```

- combine Validation:

```json
{ "valid": true }
```

- produce a final result:

```json
{
  "documentId": "123",
  "status": "PROCESSED",
  "metadata": {}
}
```

### Metadata Lambda

Update DynamoDB.

### Notification Lambda

Consume:

- SQS queue

Send:

- Email
- Webhook
- Push

Mocks are acceptable initially.

## DynamoDB

Table:

`documents`

Partition key:

`documentId`

Model:

```json
{
  "id": "123",
  "fileName": "contract.pdf",
  "status": "PROCESSING",
  "s3Key": "uploads/a.pdf",
  "ocrCompleted": true,
  "thumbnailCompleted": true,
  "eventId": "",
  "createdAt": "",
  "updatedAt": ""
}
```

### Status

Create enum `DocumentStatus`:

```ts
enum DocumentStatus {
  UPLOADED,
  PROCESSING,
  OCR_COMPLETED,
  VALIDATED,
  PROCESSED,
  FAILED
}
```

## Idempotency

Idempotency is mandatory and must be atomic.

Problem:

AWS events can be duplicated. A check like “does `eventId` exist? yes -> ignore, no -> process” implemented as a read followed by a decision creates a race condition between concurrent invocations.

Implementation:

When writing the processing record for an event, use `PutItem`/`UpdateItem` with `ConditionExpression: attribute_not_exists(eventId)` as an atomic DynamoDB operation. If the condition fails (`ConditionalCheckFailedException`), treat it as “already processed” and return without reprocessing. Never use `GetItem` followed by a separate decision.

Apply this in every Lambda that consumes an event (OCR, Thumbnail, Validation, Notification).

## SQS

Create:

- `document-notification-queue`

Configure:

- Visibility timeout: 60 seconds. Review this value if the Notification Lambda calls external webhooks that may take longer; consider increasing the timeout or decoupling the webhook call with its own retry logic instead of relying only on SQS redelivery.
- DLQ: `document-notification-dlq`
- Maximum receive count: 3

## Security

### IAM

Each Lambda must have only the permissions it needs.

Example:

OCR Lambda:

Allow:

- `s3:GetObject`

Do not allow:

- `s3:*`

### KMS

Create:

- `document-processing-key`

Use it for:

- S3 server-side encryption
- DynamoDB encryption
- SQS encryption

### WAF

Configure protections:

- rate limiting
- SQL injection
- known bad inputs
- AWS managed rules

### API authentication

Add a Cognito Authorizer, or at minimum API Key + IAM, in API Gateway before exposing any endpoint. `POST /documents` and `GET /documents/{documentId}` must not be public.

## CloudWatch

### Logs

Each Lambda should emit JSON logs under:

- `/aws/lambda/document-processing`

Example:

```json
{
  "timestamp": "",
  "level": "INFO",
  "documentId": "",
  "message": "OCR completed"
}
```

### Metrics

Create metrics for:

- DocumentsUploaded
- DocumentsProcessed
- DocumentsFailed
- OCRFailures
- ProcessingDuration

### Alarms

Create a CloudWatch Alarm for processing failures based on documents with `FAILED > 10`, including Step Functions execution failures.

Trigger:

- failed documents > 10

## Clean Architecture

Use it only where it adds value.

Structure:

```
src
├── domain
│   ├── entities
│   ├── enums
│   └── errors
├── application
│   ├── usecases
│   └── services
├── infrastructure
│   ├── aws
│   ├── dynamodb
│   └── s3
├── handlers
│   ├── api
│   └── lambda
└── tests
```

## SOLID

### Single Responsibility

Wrong:

`DocumentService`

```ts
upload()
process()
save()
notify()
```

Correct:

- `UploadService`
- `ProcessingService`
- `MetadataRepository`
- `NotificationService`

### Dependency Inversion

Create interfaces:

```ts
interface DocumentRepository {
  save()
  find()
  update()
}
```

Implementation:

- `DynamoDocumentRepository`

## KISS

Do not create:

- custom framework
- custom event bus
- unnecessary abstractions

## YAGNI

Do not implement:

- machine learning
- automatic classification
- multi-tenant support
- billing
- web dashboard

## Terraform

Expected structure:

```
terraform
├── main.tf
├── providers.tf
├── variables.tf
├── outputs.tf
├── lambda.tf
├── api_gateway.tf
├── s3.tf
├── dynamodb.tf
├── eventbridge.tf
├── step_functions.tf
├── sqs.tf
├── sns.tf
├── kms.tf
├── cloudwatch.tf
├── iam.tf
├── cognito.tf
└── waf.tf
```

## CI/CD

GitHub Actions pipeline:

Checkout -> `npm install` -> Lint -> Unit Tests -> Coverage -> Terraform Validate -> Terraform Plan -> Deploy

## Testing

Framework:

- Vitest

Coverage target:

- 80-90% is acceptable for critical-path testing in the specification, but the repository implementation currently enforces 100% coverage in the Vitest config.

Unit tests should cover:

- domain
- document creation
- status transitions
- validation
- use cases
- upload document
- process document
- update metadata
- Lambda handlers with mocked AWS services

Integration tests should use LocalStack and cover the full flow:

`POST /documents` -> generate URL -> S3 upload -> EventBridge -> Step Functions -> Lambda processing -> DynamoDB

## Documentation

Create:

- `README.md`

Must include:

- architecture
- diagram explaining that the "DynamoDB Metadata" and "DynamoDB Update" boxes represent the same `documents` table updated at two different moments in the flow
- local setup
- AWS deployment
- Terraform commands
- API documentation
- architecture decisions

## Implementation Order

Follow this order exactly:

### Phase 1

Setup:

- Node
- TypeScript
- Vitest
- ESLint

### Phase 2

Create the domain:

- Document entity
- Status
- Errors

### Phase 3

Create the Upload API, including Cognito authentication and `GET /documents/{documentId}`

### Phase 4

Create S3 + Presigned URL

### Phase 5

Create EventBridge (Step Functions execution named with `documentId`)

### Phase 6

Create Step Functions (selective retry, Catch with `FAILED` status recording)

### Phase 7

Create Lambdas:

- OCR (async via Textract + SNS + task token)
- Thumbnail (container image)
- Validation
- Merge

### Phase 8

DynamoDB (idempotency with `ConditionExpression`)

### Phase 9

SQS + DLQ + SNS

### Phase 10

KMS + IAM + WAF + Cognito

### Phase 11

CloudWatch (including EventBridge rule + alarm for Step Functions failures)

### Phase 12

Full Terraform

### Phase 13

Tests (80-90% coverage target in the specification)

### Phase 14

Final README

## Acceptance Criteria

The project is complete when:

- Upload works through the API with authentication
- `GET /documents/{documentId}` works
- The file is stored in S3
- The event is created
- EventBridge starts the workflow with a `documentId`-named execution and no duplicates
- Step Functions runs the parallel processing
- OCR runs asynchronously (Textract + SNS + task token)
- Thumbnail works as a container image
- Validation works
- Metadata is saved in DynamoDB with atomic idempotency via `ConditionExpression`
- Selective retry is configured and does not retry business errors
- DLQ is configured for the notification queue
- Step Functions failures write `FAILED` and trigger a CloudWatch Alarm
- Idempotency is implemented atomically
- CloudWatch logs are structured
- KMS is applied
- IAM follows least privilege
- Terraform reproduces the full infrastructure
- Unit and integration tests cover the critical cases

## Instructions

- Apply SOLID, KISS, and YAGNI where appropriate.
- Follow clean code practices.
- Use DDD and Clean Architecture only if they add value; avoid overengineering.
- Prefer simple, readable, and maintainable code.
- Write unit and integration tests focused on critical cases (status transitions, idempotency, partial failures).