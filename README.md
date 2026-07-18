# Document Processing Platform

A starter codebase for an event-driven document processing system.

## Tech Stack

- Node.js + TypeScript for Lambda functions
- Terraform for AWS provisioning
- API Gateway + WAF + Lambda for document upload
- S3 + EventBridge + Step Functions for orchestration
- DynamoDB for metadata and idempotency
- SQS + DLQ for notifications
- CloudWatch for logs
- KMS (CMK) for data and log encryption

## Current Structure

```text
.github/
  workflows/
    deploy.yml
    rollback.yml
docs/
  instructions.txt
infra/
  terraform/
    environments/
      dev.tfvars
      prod.tfvars
    templates/
      state-machine.asl.json.tftpl
    api.tf
    events.tf
    iam.tf
    lambda.tf
    locals.tf
    outputs.tf
    security.tf
    step-functions.tf
    storage.tf
    terraform.tfvars.example
    variables.tf
    versions.tf
src/
  contexts/
    document-ingestion/
      application/
      domain/
      infrastructure/
    document-processing/
      application/
      domain/
      infrastructure/
    notification/
      application/
      infrastructure/
  functions/
    merge-results.ts
    metadata.ts
    notification.ts
    ocr.ts
    thumbnail.ts
    upload.ts
    validation.ts
  shared/
    contracts/
    domain/
    infrastructure/
tests/
  use-cases.test.ts
workflows/
  deploy.yml
  rollback.yml
deploy.yml
rollback.yml
package.json
tsconfig.json
vitest.config.ts
```

## Design Principles

- DDD by business context
- Clean Architecture (Domain, Application, Infrastructure)
- Hexagonal architecture (ports/adapters)
- Idempotency by request key
- Event-driven design with fan-out and orchestration

## Main Flow

1. `Upload Lambda` receives a request from `API Gateway`.
2. Initial metadata is written to `DynamoDB`.
3. The file is stored in `S3`.
4. The object-created event is sent to `EventBridge`.
5. `Step Functions` runs OCR, thumbnail generation, and validation in parallel.
6. The merged result is persisted and a notification is sent through `SQS`.

Important note: the business `documentId` is consistently derived from the `S3 key` path (`<documentId>/<file>.pdf`) in the state machine.

## How To Use

```bash
npm install
npm run check
npm run build
npm run test:coverage
```

Terraform:

```bash
cd infra/terraform
terraform init
terraform plan
```

## Lambda Deploy Without Fixed Local Paths

Lambda functions are published from zip artifacts in S3 (CI/CD standard).

Recommended flow for any environment (dev, stage, prod):

1. Build and package Lambda functions in the pipeline.
2. Upload zip artifacts to an S3 artifacts bucket.
3. Set `lambda_artifacts_bucket` and `lambda_artifacts_prefix` for the target environment.
4. Run `terraform apply` using that environment artifacts.

This avoids local path dependencies such as `../../dist` and allows the same Terraform code across multiple environments.

## Environments

Environment variable files:

- `infra/terraform/environments/dev.tfvars`
- `infra/terraform/environments/prod.tfvars`

## CI/CD (GitHub Actions)

Workflows in use:

- `.github/workflows/deploy.yml`
- `.github/workflows/rollback.yml`
- `deploy.yml`
- `rollback.yml`
- `workflows/deploy.yml`
- `workflows/rollback.yml`

Behavior:

1. Open or synchronized PR: creates or updates an ephemeral environment (`pr-<number>-<branch>`).
2. Closed PR: destroys the ephemeral environment.
3. Merge into `main`: automatic deploy to `dev`.
4. `prod`: manual deploy via `workflow_dispatch`, with GitHub environment approval, only from `main` or a `v*` tag.

### Required GitHub Setup

1. Create environments: `ephemeral`, `dev`, `prod`.
2. In `prod`, configure `Required reviewers` for additional approvals.
3. Configure repository secrets:
   - `AWS_ROLE_TO_ASSUME`
   - `LAMBDA_ARTIFACTS_BUCKET`
   - `TF_STATE_BUCKET`

## Rollback

Run the `Rollback Environment` workflow with:

1. `target_environment` (`dev` or `prod`)
2. `rollback_version` (for example: `main-a1b2c3d` or `prod-a1b2c3d`)

Rollback works by pointing Terraform to a previous S3 artifacts prefix:

- `lambdas/<environment>/<rollback_version>`

## Observability and Security

- Dedicated log group for each Lambda with configurable retention.
- API Gateway and Step Functions logs in CloudWatch with KMS.
- S3, DynamoDB, SQS, and SNS encrypted with CMK (KMS).
