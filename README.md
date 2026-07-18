# Document Processing Platform

Base inicial de um sistema de processamento de arquivos com arquitetura orientada a eventos.

## Stack

- Node.js + TypeScript para Lambdas
- Terraform para provisionamento AWS
- API Gateway + WAF + Lambda para upload
- S3 + EventBridge + Step Functions para orquestração
- DynamoDB para metadados e idempotência
- SQS + DLQ para notificações
- CloudWatch para logs
- KMS (CMK) para criptografia de dados e logs

## Estrutura

```text
src/
  contexts/
    document-ingestion/
    document-processing/
    notification/
  functions/
  shared/
infra/terraform/
```

## Princípios adotados

- DDD por contexto de negócio
- Clean Architecture (Domain, Application, Infrastructure)
- Hexagonal architecture (ports/adapters)
- Idempotência por chave de requisição
- Event-driven com fan-out e orquestração

## Fluxo principal

1. `Upload Lambda` recebe requisição do `API Gateway`.
2. Metadados iniciais vão para `DynamoDB`.
3. Arquivo é salvo no `S3`.
4. Evento de objeto criado vai para `EventBridge`.
5. `Step Functions` executa OCR, thumbnail e validação em paralelo.
6. Resultado consolidado é persistido e notificação é enviada via `SQS`.

Observacao importante: o `documentId` de negocio e derivado de forma consistente do caminho `S3 key` (`<documentId>/<arquivo>.pdf`) na state machine.

## Como usar

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

## Deploy de Lambda sem path local fixo

As funcoes Lambda sao publicadas a partir de artefatos zip em S3 (padrao CI/CD).

Fluxo recomendado para qualquer ambiente (dev, stage, prod):

1. Build e empacotamento das Lambdas no pipeline.
2. Upload dos zips para um bucket de artefatos S3.
3. Definicao das variaveis `lambda_artifacts_bucket` e `lambda_artifacts_prefix` no ambiente.
4. `terraform apply` usando os artefatos daquele ambiente.

Isso evita dependencia de caminhos locais como `../../dist` e permite o mesmo codigo Terraform para multiplos ambientes.

## Ambientes

Arquivos de variaveis por ambiente:

- `infra/terraform/environments/dev.tfvars`
- `infra/terraform/environments/prod.tfvars`

## CI/CD (GitHub Actions)

Workflows:

- `.github/workflows/deploy.yml`
- `.github/workflows/rollback.yml`

Comportamento:

1. PR aberta/sincronizada: cria ou atualiza ambiente efemero (`pr-<numero>-<branch>`).
2. PR fechada: destroi ambiente efemero.
3. Merge na `main`: deploy automatico em `dev`.
4. `prod`: deploy manual via `workflow_dispatch` com aprovacao de ambiente no GitHub e somente a partir de `main` ou tag `v*`.

### Configuracao obrigatoria no GitHub

1. Criar os environments: `ephemeral`, `dev`, `prod`.
2. Em `prod`, configurar `Required reviewers` para aprovacoes extras.
3. Configurar secrets de repositorio:
  - `AWS_ROLE_TO_ASSUME`
  - `LAMBDA_ARTIFACTS_BUCKET`
  - `TF_STATE_BUCKET`

## Rollback

Executar o workflow `Rollback Environment` informando:

1. `target_environment` (`dev` ou `prod`)
2. `rollback_version` (ex.: `main-a1b2c3d` ou `prod-a1b2c3d`)

O rollback funciona apontando o Terraform para um prefixo anterior de artefatos em S3:

- `lambdas/<ambiente>/<rollback_version>`

## Observabilidade e seguranca

- Log group dedicado para cada Lambda com retencao configuravel.
- Logs de API Gateway e Step Functions no CloudWatch com KMS.
- S3, DynamoDB, SQS e SNS com criptografia usando CMK (KMS).
