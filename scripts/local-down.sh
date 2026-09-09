#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"

terraform -chdir=infra/terraform init -input=false
terraform -chdir=infra/terraform destroy -input=false -auto-approve -var-file=environments/local.tfvars
npm run localstack:down

echo "Local environment has been destroyed."
