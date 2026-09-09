#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# newman is intentionally not a project devDependency: its dependency tree (postman-runtime,
# handlebars, etc.) carries several known high/critical vulnerabilities. Running it via npx
# keeps it out of package.json/package-lock.json and this project's own audit surface, while
# still giving us an automated way to execute the Postman collection.
npx --yes newman@6.2.2 run postman/document-processing-platform-local.postman_collection.json \
  --env-var "localPdfPath=$ROOT_DIR/postman/contract.pdf" \
  -e postman/document-processing-platform-local.postman_environment.json \
  --reporters cli
