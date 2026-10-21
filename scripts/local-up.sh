#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run package:local
npm run localstack:up
terraform -chdir=infra/terraform init -input=false
terraform -chdir=infra/terraform apply -input=false -auto-approve -var-file=environments/local.tfvars

echo "Local environment is ready."
echo "Postman local collection: postman/document-processing-platform-local.postman_collection.json"
echo "Postman local environment: postman/document-processing-platform-local.postman_environment.json"