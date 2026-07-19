#!/usr/bin/env node

import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION || "us-east-1";
const LOCALSTACK_ENDPOINT = process.env.AWS_ENDPOINT_URL || "http://127.0.0.1:4566";
const FUNCTION_PREFIX = process.env.LOCAL_FUNCTION_PREFIX || "document-processing-platform-local";

const results = [];

function logSection(title) {
  console.log("\n========================================");
  console.log(title);
  console.log("========================================");
}

function pass(step, detail) {
  results.push({ step, ok: true, detail });
  console.log(`OK   ${step} - ${detail}`);
}

function fail(step, error) {
  const message = error instanceof Error ? error.message : String(error);
  results.push({ step, ok: false, detail: message });
  console.error(`FAIL ${step} - ${message}`);
  throw error;
}

function summaryAndExit() {
  logSection("Local E2E test summary");
  let hasFailure = false;

  for (const row of results) {
    const marker = row.ok ? "[OK]" : "[FAIL]";
    console.log(`${marker} ${row.step} -> ${row.detail}`);
    if (!row.ok) {
      hasFailure = true;
    }
  }

  if (hasFailure) {
    console.error("\nFinal result: FAILURE");
    process.exit(1);
  }

  console.log("\nFinal result: SUCCESS");
  process.exit(0);
}

function runCmd(step, command) {
  try {
    const out = execSync(command, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    pass(step, command);
    return out.trim();
  } catch (error) {
    fail(step, error);
  }
}

function toJsonPayload(data) {
  return Buffer.from(JSON.stringify(data));
}

function parseLambdaPayload(payloadBuffer) {
  const text = Buffer.from(payloadBuffer || []).toString("utf8");
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

async function invokeLambda(lambdaClient, functionName, payload, step) {
  try {
    const result = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        Payload: toJsonPayload(payload)
      })
    );

    if (result.FunctionError) {
      const raw = Buffer.from(result.Payload || []).toString("utf8");
      throw new Error(`FunctionError=${result.FunctionError} payload=${raw}`);
    }

    const parsed = parseLambdaPayload(result.Payload);
    pass(step, functionName);
    return parsed;
  } catch (error) {
    fail(step, error);
  }
}

async function uploadUsingPresignedUrl(uploadUrl, contentType, fileBytes) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType
    },
    body: fileBytes
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Upload failed status=${response.status} body=${body}`);
  }
}

async function main() {
  logSection("Local preparation");

  runCmd("Reset LocalStack", "npm run localstack:down");
  runCmd("Start LocalStack", "npm run localstack:up");
  runCmd("Package lambdas", "npm run package:local");
  runCmd(
    "Apply local Terraform",
    "terraform -chdir=infra/terraform apply -auto-approve -var-file=environments/local.tfvars"
  );

  let tfOutputRaw = "{}";
  try {
    tfOutputRaw = runCmd("Read Terraform outputs", "terraform -chdir=infra/terraform output -json");
  } catch {
    tfOutputRaw = "{}";
  }

  const tfOutput = JSON.parse(tfOutputRaw || "{}");
  const documentsBucket = tfOutput?.documents_bucket?.value;
  if (!documentsBucket) {
    fail("Validate documents_bucket output", new Error("documents_bucket not found"));
  } else {
    pass("Validate documents_bucket output", documentsBucket);
  }

  const lambdaClient = new LambdaClient({
    region: REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
    }
  });

  const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: REGION,
      endpoint: LOCALSTACK_ENDPOINT,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
      }
    })
  );

  logSection("Step 1: Upload route entry");

  const uploadEvent = {
    version: "2.0",
    routeKey: "POST /documents",
    rawPath: "/documents",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "x-idempotency-key": `req-local-${Date.now()}`
    },
    requestContext: {
      requestId: `req-local-${Date.now()}`,
      http: {
        method: "POST",
        path: "/documents"
      }
    },
    isBase64Encoded: false,
    body: JSON.stringify({
      fileName: "contract.pdf",
      contentType: "application/pdf"
    })
  };

  const uploadResponse = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-upload`,
    uploadEvent,
    "Invoke Upload Lambda (POST /documents route)"
  );

  if (!uploadResponse || typeof uploadResponse !== "object") {
    fail("Validate Upload Lambda response", new Error("Empty response"));
  }

  if ((uploadResponse.statusCode || 0) !== 200) {
    let errorBody = uploadResponse.body;
    try {
      const parsedBody = JSON.parse(uploadResponse.body || "{}");
      errorBody = parsedBody.message || JSON.stringify(parsedBody);
    } catch {
      // keep raw body
    }

    fail(
      "Validate Upload Lambda status",
      new Error(`Unexpected status: ${uploadResponse.statusCode}; detail: ${errorBody}`)
    );
  }

  let uploadBody;
  try {
    uploadBody = JSON.parse(uploadResponse.body || "{}");
  } catch (error) {
    fail("Parse Upload Lambda body", error);
  }

  const documentId = uploadBody.documentId;
  const uploadUrl = uploadBody.uploadUrl;
  const key = uploadBody.key;

  if (!documentId || !uploadUrl || !key) {
    fail("Validate upload response contract", new Error("documentId, uploadUrl, and key are required"));
  }

  pass("Validate upload response contract", `documentId=${documentId}`);

  logSection("Step 2: S3 upload via presigned URL");

  const fakePdf = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
    "utf8"
  );

  try {
    await uploadUsingPresignedUrl(uploadUrl, "application/pdf", fakePdf);
    pass("Upload file to S3", key);
  } catch (error) {
    fail("Upload file to S3", error);
  }

  logSection("Step 3: Processing (local fallback without Step Functions)");

  const processingRequest = {
    documentId,
    bucket: documentsBucket,
    key
  };

  const ocrResult = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-ocr`,
    processingRequest,
    "Run OCR Lambda"
  );

  const thumbnailResult = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-thumbnail`,
    processingRequest,
    "Run Thumbnail Lambda"
  );

  const validationResult = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-validation`,
    processingRequest,
    "Run Validation Lambda"
  );

  const mergeResult = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-merge_results`,
    {
      documentId,
      ocr: ocrResult,
      thumbnail: thumbnailResult,
      validation: validationResult
    },
    "Run Merge Results Lambda"
  );

  const metadataResult = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-metadata`,
    mergeResult,
    "Run Metadata Lambda"
  );

  if (!metadataResult || metadataResult.ok !== true) {
    fail("Validate Metadata Lambda response", new Error("metadata.ok should be true"));
  }

  pass("Validate Metadata Lambda response", "ok=true");

  logSection("Step 4: DynamoDB persistence verification");

  const tableName = `${FUNCTION_PREFIX}-documents-metadata`;

  await sleep(1500);

  try {
    const item = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          pk: `DOCUMENT#${documentId}`,
          sk: "PROCESSING_RESULT"
        }
      })
    );

    if (!item.Item) {
      throw new Error("PROCESSING_RESULT item not found in DynamoDB");
    }

    pass("Verify processed metadata in DynamoDB", tableName);
  } catch (error) {
    fail("Verify processed metadata in DynamoDB", error);
  }

  logSection("Step 5: Notification Lambda verification");

  const notificationEvent = {
    Records: [
      {
        messageId: `msg-${Date.now()}`,
        receiptHandle: "rh",
        body: JSON.stringify({
          documentId,
          type: "DOCUMENT_PROCESSED",
          processedAt: new Date().toISOString()
        }),
        attributes: {},
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-1:000000000000:fake",
        awsRegion: REGION
      }
    ]
  };

  const notificationResult = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-notification`,
    notificationEvent,
    "Run Notification Lambda"
  );

  if (!notificationResult || notificationResult.ok !== true) {
    fail("Validate Notification Lambda response", new Error("notification.ok should be true"));
  }

  pass("Validate Notification Lambda response", "ok=true");

  summaryAndExit();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFatal error: ${message}`);
  summaryAndExit();
});