#!/usr/bin/env node

import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import dns from "node:dns";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { S3Client, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The presigned upload URL LocalStack returns uses `localhost.localstack.cloud`
 * (see README "Project Notes") -- Lambda containers need that public-DNS-to-127.0.0.1
 * trick to reach the host's LocalStack instance, so Terraform hardcodes it as
 * AWS_ENDPOINT_URL for every local Lambda. This script's own `fetch` PUT to that same
 * presigned URL runs on the host, though, and network-restricted sandboxes/CI runners
 * with no DNS resolver at all (not just no internet) can't resolve it even though
 * LocalStack itself is reachable on 127.0.0.1:4566. Patching `dns.lookup` for just this
 * hostname reproduces a hosts-file override without needing root on the host.
 */
const originalDnsLookup = dns.lookup;
dns.lookup = function patchedLookup(hostname, ...rest) {
  if (hostname === "localhost.localstack.cloud") {
    const callback = rest[rest.length - 1];
    const options = rest.length > 1 ? rest[0] : undefined;
    if (options && typeof options === "object" && options.all) {
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
    } else {
      callback(null, "127.0.0.1", 4);
    }
    return undefined;
  }
  return originalDnsLookup.call(dns, hostname, ...rest);
};

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

async function invokeExpectFunctionError(lambdaClient, functionName, payload, step) {
  try {
    const result = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        Payload: toJsonPayload(payload)
      })
    );

    const raw = Buffer.from(result.Payload || []).toString("utf8");

    if (!result.FunctionError) {
      throw new Error(`Expected a FunctionError but the Lambda succeeded: ${raw}`);
    }

    pass(step, `FunctionError=${result.FunctionError} as expected`);
    return raw;
  } catch (error) {
    fail(step, error);
  }
}

function assertIncludes(step, haystack, needle) {
  if (!haystack.includes(needle)) {
    fail(step, new Error(`Expected "${needle}" in: ${haystack}`));
    return;
  }
  pass(step, `contains "${needle}"`);
}

function httpEvent({ method, path, body, headers = {}, pathParameters }) {
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers,
    pathParameters,
    requestContext: {
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      http: { method, path }
    },
    isBase64Encoded: false,
    body: body !== undefined ? JSON.stringify(body) : undefined
  };
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
  runCmd("Initialize local Terraform", "terraform -chdir=infra/terraform init -input=false");
  runCmd(
    "Apply local Terraform",
    "terraform -chdir=infra/terraform apply -input=false -auto-approve -var-file=environments/local.tfvars"
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

  const s3 = new S3Client({
    region: REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
    }
  });

  const sqs = new SQSClient({
    region: REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
    }
  });

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

  logSection("Step 6: Get Document Status (success)");

  const statusEvent = httpEvent({
    method: "GET",
    path: `/documents/${documentId}`,
    pathParameters: { documentId }
  });

  const statusResponse = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-get_document`,
    statusEvent,
    "Invoke Get-Document-Status Lambda for the processed document"
  );

  if (statusResponse.statusCode !== 200) {
    fail(
      "Validate Get-Document-Status success response",
      new Error(`Unexpected status: ${statusResponse.statusCode}`)
    );
  } else {
    const statusBody = JSON.parse(statusResponse.body);
    if (statusBody.status !== "PROCESSED") {
      fail(
        "Validate Get-Document-Status success response",
        new Error(`Expected status=PROCESSED, got ${statusBody.status}`)
      );
    } else {
      pass("Validate Get-Document-Status success response", "status=PROCESSED");
    }
  }

  logSection("Step 7: Upload idempotency (duplicate request)");

  const idempotencyKey = `req-idempotency-${Date.now()}`;
  const duplicateUploadEvent = httpEvent({
    method: "POST",
    path: "/documents",
    headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
    body: { fileName: "duplicate.pdf", contentType: "application/pdf" }
  });

  const firstCall = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-upload`,
    duplicateUploadEvent,
    "First upload call (idempotency key A)"
  );
  const secondCall = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-upload`,
    duplicateUploadEvent,
    "Duplicate upload call (same idempotency key)"
  );

  const firstBody = JSON.parse(firstCall.body);
  const secondBody = JSON.parse(secondCall.body);

  if (firstBody.documentId === secondBody.documentId && firstBody.uploadUrl === secondBody.uploadUrl) {
    pass(
      "Validate idempotent dedup",
      "duplicate request returned the identical cached response (work was not redone)"
    );
  } else {
    fail(
      "Validate idempotent dedup",
      new Error("Duplicate request produced a different response; idempotency did not short-circuit")
    );
  }

  logSection("Failure scenario: Upload payload validation");

  const invalidJsonResponse = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-upload`,
    { ...httpEvent({ method: "POST", path: "/documents" }), body: "{not-json" },
    "Invoke Upload Lambda with malformed JSON body"
  );
  if (invalidJsonResponse.statusCode === 400) {
    pass("Validate malformed-JSON rejection", "statusCode=400");
  } else {
    fail(
      "Validate malformed-JSON rejection",
      new Error(`Expected 400, got ${invalidJsonResponse.statusCode}`)
    );
  }

  const missingFileNameResponse = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-upload`,
    httpEvent({ method: "POST", path: "/documents", body: { contentType: "application/pdf" } }),
    "Invoke Upload Lambda with missing fileName"
  );
  if (missingFileNameResponse.statusCode === 400) {
    pass("Validate missing-fileName rejection", "statusCode=400");
  } else {
    fail(
      "Validate missing-fileName rejection",
      new Error(`Expected 400, got ${missingFileNameResponse.statusCode}`)
    );
  }

  logSection("Failure scenario: Get Document Status");

  const unknownStatusResponse = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-get_document`,
    httpEvent({
      method: "GET",
      path: "/documents/doc-does-not-exist",
      pathParameters: { documentId: "doc-does-not-exist" }
    }),
    "Invoke Get-Document-Status Lambda for an unknown documentId"
  );
  if (unknownStatusResponse.statusCode === 404) {
    pass("Validate unknown-document rejection", "statusCode=404");
  } else {
    fail(
      "Validate unknown-document rejection",
      new Error(`Expected 404, got ${unknownStatusResponse.statusCode}`)
    );
  }

  const missingIdResponse = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-get_document`,
    httpEvent({ method: "GET", path: "/documents/", pathParameters: {} }),
    "Invoke Get-Document-Status Lambda with no documentId path parameter"
  );
  if (missingIdResponse.statusCode === 400) {
    pass("Validate missing-documentId rejection", "statusCode=400");
  } else {
    fail(
      "Validate missing-documentId rejection",
      new Error(`Expected 400, got ${missingIdResponse.statusCode}`)
    );
  }

  logSection("Failure scenario: business validation (Validation Lambda)");

  const emptyFileUpload = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-upload`,
    httpEvent({
      method: "POST",
      path: "/documents",
      headers: { "x-idempotency-key": `req-empty-${Date.now()}` },
      body: { fileName: "empty.pdf", contentType: "application/pdf" }
    }),
    "Invoke Upload Lambda for the empty-file scenario"
  );
  const emptyFileBody = JSON.parse(emptyFileUpload.body);
  await uploadUsingPresignedUrl(emptyFileBody.uploadUrl, "application/pdf", Buffer.alloc(0));
  pass("Upload a 0-byte file to S3", emptyFileBody.key);

  const emptyFileValidation = await invokeExpectFunctionError(
    lambdaClient,
    `${FUNCTION_PREFIX}-validation`,
    { documentId: emptyFileBody.documentId, bucket: documentsBucket, key: emptyFileBody.key },
    "Invoke Validation Lambda against the empty file (expect rejection)"
  );
  assertIncludes("Validate empty-file rejection reason", emptyFileValidation, "Empty file");

  const wrongTypeUpload = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-upload`,
    httpEvent({
      method: "POST",
      path: "/documents",
      headers: { "x-idempotency-key": `req-wrongtype-${Date.now()}` },
      body: { fileName: "notes.txt", contentType: "text/plain" }
    }),
    "Invoke Upload Lambda for the wrong-content-type scenario"
  );
  const wrongTypeBody = JSON.parse(wrongTypeUpload.body);
  await uploadUsingPresignedUrl(wrongTypeBody.uploadUrl, "text/plain", Buffer.from("not a pdf"));
  pass("Upload a non-PDF file to S3", wrongTypeBody.key);

  const wrongTypeValidation = await invokeExpectFunctionError(
    lambdaClient,
    `${FUNCTION_PREFIX}-validation`,
    { documentId: wrongTypeBody.documentId, bucket: documentsBucket, key: wrongTypeBody.key },
    "Invoke Validation Lambda against the non-PDF file (expect rejection)"
  );
  assertIncludes("Validate wrong-content-type rejection reason", wrongTypeValidation, "Invalid Content-Type");

  logSection("Failure scenario: infrastructure error (missing S3 object)");

  const missingObjectResult = await invokeExpectFunctionError(
    lambdaClient,
    `${FUNCTION_PREFIX}-thumbnail`,
    {
      documentId: "doc-missing-object",
      bucket: documentsBucket,
      key: "doc-missing-object/does-not-exist.pdf"
    },
    "Invoke Thumbnail Lambda against a non-existent S3 object (expect infra error)"
  );
  if (/NotFound|404|does not exist/i.test(missingObjectResult)) {
    pass("Validate missing-object error surfaces S3 NotFound", "NotFound-style error observed");
  } else {
    fail(
      "Validate missing-object error surfaces S3 NotFound",
      new Error(`Unexpected error shape: ${missingObjectResult}`)
    );
  }

  logSection("Failure scenario: workflow failure handling (Metadata Lambda)");

  const failedDocumentId = `doc-failed-${Date.now()}`;
  const metadataFailedResult = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-metadata`,
    {
      documentId: failedDocumentId,
      status: "FAILED",
      errorMessage: "OCR failed: synthetic test failure"
    },
    "Invoke Metadata Lambda with a FAILED workflow event"
  );
  if (metadataFailedResult?.ok === true && metadataFailedResult?.status === "FAILED_RECORDED") {
    pass("Validate FAILED workflow event was recorded", "ok=true, status=FAILED_RECORDED");
  } else {
    fail(
      "Validate FAILED workflow event was recorded",
      new Error(`Unexpected response: ${JSON.stringify(metadataFailedResult)}`)
    );
  }

  await sleep(1000);

  const failedStatusResponse = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-get_document`,
    httpEvent({
      method: "GET",
      path: `/documents/${failedDocumentId}`,
      pathParameters: { documentId: failedDocumentId }
    }),
    "Invoke Get-Document-Status Lambda for the FAILED document"
  );
  const failedStatusBody = JSON.parse(failedStatusResponse.body);
  if (failedStatusBody.status === "FAILED" && failedStatusBody.errorMessage) {
    pass("Verify FAILED status persisted in DynamoDB", `errorMessage="${failedStatusBody.errorMessage}"`);
  } else {
    fail(
      "Verify FAILED status persisted in DynamoDB",
      new Error(`Unexpected status record: ${JSON.stringify(failedStatusBody)}`)
    );
  }

  logSection("Failure scenario: missing configuration (Start-Workflow Lambda)");

  const startWorkflowResult = await invokeExpectFunctionError(
    lambdaClient,
    `${FUNCTION_PREFIX}-start_workflow`,
    { bucket: documentsBucket, key: `${documentId}/contract.pdf`, documentId },
    "Invoke Start-Workflow Lambda (Step Functions disabled locally: expect ConfigurationError)"
  );
  assertIncludes(
    "Validate Start-Workflow ConfigurationError",
    startWorkflowResult,
    "STEP_FUNCTIONS_ARN"
  );

  logSection("Real file scenario: send a real PDF end-to-end and verify returned artifacts");

  const realPdfPath = resolvePath(__dirname, "../../postman/contract.pdf");
  const realPdfBytes = readFileSync(realPdfPath);

  const realFileUpload = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-upload`,
    httpEvent({
      method: "POST",
      path: "/documents",
      headers: { "x-idempotency-key": `req-realfile-${Date.now()}` },
      body: { fileName: "contract.pdf", contentType: "application/pdf" }
    }),
    "Invoke Upload Lambda for the real-file scenario"
  );
  const realFileBody = JSON.parse(realFileUpload.body);

  await uploadUsingPresignedUrl(realFileBody.uploadUrl, "application/pdf", realPdfBytes);
  pass("Upload the real contract.pdf file to S3", `${realFileBody.key} (${realPdfBytes.length} bytes)`);

  const realFileRequest = { documentId: realFileBody.documentId, bucket: documentsBucket, key: realFileBody.key };

  const realOcr = await invokeLambda(lambdaClient, `${FUNCTION_PREFIX}-ocr`, realFileRequest, "Run OCR Lambda on the real file");
  const realThumbnail = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-thumbnail`,
    realFileRequest,
    "Run Thumbnail Lambda on the real file"
  );
  const realValidation = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-validation`,
    realFileRequest,
    "Run Validation Lambda on the real file"
  );

  if (realValidation?.valid !== true) {
    fail("Validate the real PDF passes validation", new Error(JSON.stringify(realValidation)));
  } else {
    pass("Validate the real PDF passes validation", "valid=true");
  }

  const realMerge = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-merge_results`,
    { documentId: realFileBody.documentId, ocr: realOcr, thumbnail: realThumbnail, validation: realValidation },
    "Run Merge Results Lambda on the real file"
  );
  await invokeLambda(lambdaClient, `${FUNCTION_PREFIX}-metadata`, realMerge, "Run Metadata Lambda on the real file");

  await sleep(1000);

  logSection("Real file scenario: verify returned thumbnail artifacts actually exist in S3");

  for (const imageKey of [...(realThumbnail.pageKeys ?? []), realThumbnail.thumbnailKey]) {
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: documentsBucket, Key: imageKey }));
      if ((head.ContentLength ?? 0) <= 0 || head.ContentType !== "image/png") {
        throw new Error(`Unexpected artifact shape: ContentLength=${head.ContentLength}, ContentType=${head.ContentType}`);
      }
      pass(`Verify thumbnail artifact exists in S3 (${imageKey})`, `${head.ContentLength} bytes, ${head.ContentType}`);
    } catch (error) {
      fail(`Verify thumbnail artifact exists in S3 (${imageKey})`, error);
    }
  }

  try {
    const preview = await s3.send(new GetObjectCommand({ Bucket: documentsBucket, Key: realThumbnail.thumbnailKey }));
    const previewBytes = Buffer.from(await preview.Body.transformToByteArray());
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!previewBytes.subarray(0, 8).equals(pngSignature)) {
      throw new Error("Downloaded preview thumbnail does not start with a valid PNG signature");
    }
    pass("Download and validate the preview thumbnail's PNG signature", `${previewBytes.length} bytes`);
  } catch (error) {
    fail("Download and validate the preview thumbnail's PNG signature", error);
  }

  const realStatusResponse = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-get_document`,
    httpEvent({
      method: "GET",
      path: `/documents/${realFileBody.documentId}`,
      pathParameters: { documentId: realFileBody.documentId }
    }),
    "Invoke Get-Document-Status Lambda for the real-file document (verify the returned payload)"
  );
  const realStatusBody = JSON.parse(realStatusResponse.body);
  if (realStatusResponse.statusCode === 200 && realStatusBody.status === "PROCESSED") {
    pass("Validate the final returned status payload for the real file", `status=PROCESSED`);
  } else {
    fail(
      "Validate the final returned status payload for the real file",
      new Error(`Unexpected response: ${JSON.stringify(realStatusBody)}`)
    );
  }

  logSection("Concurrency scenario: two concurrent uploads sharing the same idempotency key");

  const concurrentKey = `req-concurrent-${Date.now()}`;
  const concurrentEvent = httpEvent({
    method: "POST",
    path: "/documents",
    headers: { "x-idempotency-key": concurrentKey },
    body: { fileName: "concurrent.pdf", contentType: "application/pdf" }
  });

  const [concurrentA, concurrentB] = await Promise.all([
    invokeLambda(lambdaClient, `${FUNCTION_PREFIX}-upload`, concurrentEvent, "Concurrent upload call A"),
    invokeLambda(lambdaClient, `${FUNCTION_PREFIX}-upload`, concurrentEvent, "Concurrent upload call B")
  ]);

  const concurrentBodyA = JSON.parse(concurrentA.body);
  const concurrentBodyB = JSON.parse(concurrentB.body);

  if (
    concurrentA.statusCode === 200 &&
    concurrentB.statusCode === 200 &&
    concurrentBodyA.documentId === concurrentBodyB.documentId &&
    concurrentBodyA.uploadUrl === concurrentBodyB.uploadUrl
  ) {
    pass(
      "Validate race-safe idempotency under real concurrency",
      "both concurrent calls converged on the identical cached response"
    );
  } else {
    fail(
      "Validate race-safe idempotency under real concurrency",
      new Error(`Diverging responses: A=${concurrentA.body} B=${concurrentB.body}`)
    );
  }

  logSection("Notification scenario: idempotent duplicate SQS delivery");

  const sharedMessageId = `msg-dup-${Date.now()}`;
  const duplicateNotificationEvent = {
    Records: [
      {
        messageId: sharedMessageId,
        receiptHandle: "rh",
        body: JSON.stringify({
          documentId: realFileBody.documentId,
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

  await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-notification`,
    duplicateNotificationEvent,
    "First delivery of SQS message (messageId X)"
  );
  const secondDeliveryResult = await invokeLambda(
    lambdaClient,
    `${FUNCTION_PREFIX}-notification`,
    duplicateNotificationEvent,
    "Duplicate re-delivery of the exact same SQS message (same messageId X, at-least-once semantics)"
  );

  if (secondDeliveryResult?.ok === true) {
    pass(
      "Validate duplicate SQS delivery is short-circuited by idempotency",
      "second delivery returned ok=true without re-publishing to SNS"
    );
  } else {
    fail(
      "Validate duplicate SQS delivery is short-circuited by idempotency",
      new Error(`Unexpected response: ${JSON.stringify(secondDeliveryResult)}`)
    );
  }

  logSection("Failure scenario: notification Lambda with a malformed SQS message body");

  const malformedNotificationEvent = {
    Records: [
      {
        messageId: `msg-malformed-${Date.now()}`,
        receiptHandle: "rh",
        body: "{not-json",
        attributes: {},
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-1:000000000000:fake",
        awsRegion: REGION
      }
    ]
  };

  await invokeExpectFunctionError(
    lambdaClient,
    `${FUNCTION_PREFIX}-notification`,
    malformedNotificationEvent,
    "Invoke Notification Lambda with a malformed message body (expect rejection, eligible for DLQ redrive)"
  );

  logSection("Infrastructure scenario: verify the notification queue's DLQ and visibility timeout");

  const notificationQueueUrl = tfOutput?.notification_queue_url?.value;
  if (!notificationQueueUrl) {
    fail("Read notification_queue_url output", new Error("notification_queue_url not found"));
  } else {
    try {
      const attributes = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: notificationQueueUrl,
          AttributeNames: ["RedrivePolicy", "VisibilityTimeout"]
        })
      );
      const redrivePolicy = JSON.parse(attributes.Attributes?.RedrivePolicy ?? "{}");
      const visibilityTimeout = Number(attributes.Attributes?.VisibilityTimeout ?? 0);

      if (redrivePolicy.maxReceiveCount === 3 && visibilityTimeout === 120 && redrivePolicy.deadLetterTargetArn) {
        pass(
          "Verify notification queue DLQ + visibility timeout configuration",
          `maxReceiveCount=3, visibilityTimeout=120s, dlq=${redrivePolicy.deadLetterTargetArn}`
        );
      } else {
        throw new Error(`Unexpected queue attributes: ${JSON.stringify(attributes.Attributes)}`);
      }
    } catch (error) {
      fail("Verify notification queue DLQ + visibility timeout configuration", error);
    }
  }

  summaryAndExit();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFatal error: ${message}`);
  summaryAndExit();
});