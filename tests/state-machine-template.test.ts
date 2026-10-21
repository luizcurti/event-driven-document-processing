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

  // Flatten the three parallel branches' states alongside the top-level ones so
  // every state (nested or not) can be looked up by name in one place.
  type AslState = {
    Type: string;
    Resource?: string;
    Next?: string;
    Retry?: Array<{ ErrorEquals: string[] }>;
    Catch?: Array<{ ErrorEquals: string[] }>;
    Parameters?: { Payload?: Record<string, unknown> };
  };
  const branchStates: [string, AslState][] = asJson.States.FanOutProcessing.Branches.flatMap(
    (branch: { States: Record<string, AslState> }) => Object.entries(branch.States)
  );
  const allStates: Record<string, AslState> = { ...asJson.States, ...Object.fromEntries(branchStates) };

  // A missing key here means the template renamed/removed a state this suite expects —
  // fail with that message instead of a cryptic "possibly undefined" access below.
  function getState(name: string): AslState {
    const state = allStates[name];
    if (!state) {
      throw new Error(`ASL template has no state named "${name}"`);
    }
    return state;
  }

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

  /**
   * The spec mandates selective retry: only transient/infrastructure errors may be
   * retried, and business validation errors must go straight to Catch. A Retry block
   * with "States.ALL" (or any error name beyond the three transient ones) would silently
   * retry a corrupted-file rejection three times before failing, wasting time and masking
   * the real error. Nothing else in the pipeline (terraform validate, ASL syntax) checks
   * this, since both a correct and an overly-broad Retry are syntactically valid ASL.
   */
  const transientErrors = ["Lambda.ServiceException", "Lambda.TooManyRequestsException", "States.Timeout"];
  const tasksWithRetry = ["OCR", "Thumbnail", "Validation", "PersistMetadata"];

  it.each(tasksWithRetry)("retries only transient errors in the %s task, never States.ALL", (taskName) => {
    const retry = getState(taskName).Retry ?? [];

    // The length assertion above is what actually guarantees index 0 exists; the
    // non-null assertion just reflects that to the type checker.
    expect(retry).toHaveLength(1);
    expect(retry[0]!.ErrorEquals.slice().sort()).toEqual(transientErrors.slice().sort());
  });

  it("sends the Validation task's business ValidationError straight to Catch, without retrying it", () => {
    const validationState = getState("Validation");
    const catchErrorNames = (validationState.Catch ?? []).flatMap((entry) => entry.ErrorEquals);
    const retry = validationState.Retry ?? [];

    expect(catchErrorNames).toContain("ValidationError");
    expect(retry).toHaveLength(1);
    expect(retry[0]!.ErrorEquals).not.toContain("ValidationError");
  });

  it("writes FAILED metadata before transitioning to a Fail state on every Catch path", () => {
    const catchTargets = [
      { recordState: "RecordFailureOCR", failState: "FailOCR" },
      { recordState: "RecordFailureThumbnail", failState: "FailThumbnail" },
      { recordState: "RecordFailureValidation", failState: "FailValidation" },
      { recordState: "RecordFailurePipeline", failState: "FailPipeline" }
    ];

    for (const { recordState, failState } of catchTargets) {
      const record = getState(recordState);
      const fail = getState(failState);

      expect((record.Parameters?.Payload as { status?: string } | undefined)?.status).toBe("FAILED");
      expect(record.Next).toBe(failState);
      expect(fail.Type).toBe("Fail");
    }
  });

  it("keeps the OCR task on the async waitForTaskToken pattern, not a synchronous invoke", () => {
    expect(getState("OCR").Resource).toBe("arn:aws:states:::lambda:invoke.waitForTaskToken");
  });
});
