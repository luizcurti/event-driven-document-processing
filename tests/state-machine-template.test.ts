import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression test for a bug where MergeResults read `$.thumbnail.thumbnail` /
 * `$.validation.validation` from the Step Functions input, but NormalizeParallelOutput
 * had already unwrapped those branches to flat `{thumbnailKey,...}` /
 * `{valid,...}` objects with no nested `.thumbnail` / `.validation` field. Step
 * Functions throws a "field could not be found" runtime error on every single
 * execution when that happens — `terraform validate` doesn't catch it (syntax only),
 * and no local test previously exercised this template at all, since Step Functions
 * is disabled in local mode.
 */
describe("state machine ASL template", () => {
  const templatePath = resolve(
    __dirname,
    "../infra/terraform/templates/state-machine.asl.json.tftpl"
  );
  const raw = readFileSync(templatePath, "utf-8");

  // The template has `${...}` Terraform interpolations, which aren't valid JSON.
  // Substitute placeholders so it can be parsed and its structure asserted on.
  const asJson = JSON.parse(raw.replace(/\$\{[^}]+\}/g, "placeholder-arn"));

  it("passes NormalizeParallelOutput's flat thumbnail/validation objects straight through to MergeResults", () => {
    const mergeParams = asJson.States.MergeResults.Parameters.Payload;

    expect(mergeParams["thumbnail.$"]).toBe("$.thumbnail");
    expect(mergeParams["validation.$"]).toBe("$.validation");
  });

  it("keeps NormalizeParallelOutput producing exactly those flat shapes", () => {
    const normalizeParams = asJson.States.NormalizeParallelOutput.Parameters;

    expect(normalizeParams["thumbnail.$"]).toBe("$.parallelResults[1]");
    expect(normalizeParams["validation.$"]).toBe("$.parallelResults[2]");
  });
});
