import assert from "node:assert/strict";
import test from "node:test";
import { REGISTRY } from "../../open-sse/config/providers/index.ts";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.ts";
import { resolveOpencodeTargetFormat } from "../../open-sse/executors/opencode.ts";
import { applyDefaultReasoningEffort } from "../../open-sse/services/defaultReasoningEffort.ts";
import { FORMATS } from "../../open-sse/translator/formats.ts";
import { normalizeResponsesReasoningEffort } from "../../open-sse/translator/request/openai-responses/helpers.ts";

const routes = [
  ["opencode", "muse-spark-1.3"],
  ["opencode", "muse-spark-1.3-contributor-free"],
  ["opencode-zen", "muse-spark-1.3"],
  ["opencode-zen", "muse-spark-1.3-contributor-free"],
  ["opencode-go", "muse-spark-1.3-contributor"],
];

test("Standard Muse 1.3 preserves native max while Contributor cannot claim it", () => {
  for (const model of ["muse-spark-1.3", "opencode-zen/muse-spark-1.3", "oc/muse-spark-1.3"]) {
    assert.equal(normalizeResponsesReasoningEffort("max", model), "max");
  }
  assert.equal(normalizeResponsesReasoningEffort("max", "muse-spark-1.3-contributor"), "xhigh");
  assert.equal(normalizeResponsesReasoningEffort("max", "muse-spark-1.2"), "xhigh");
});

for (const [provider, modelId] of routes) {
  test(`${provider}/${modelId} declares supported effort without inventing a default`, () => {
    const model = REGISTRY[provider].models.find((entry) => entry.id === modelId);
    assert.ok(model);
    assert.equal(model.supportsReasoning, true);
    assert.equal(model.targetFormat, FORMATS.OPENAI_RESPONSES);
    assert.ok(model.supportedThinkingEfforts?.includes("xhigh"));
    assert.equal(model.supportedThinkingEfforts?.includes("max"), !modelId.includes("contributor"));
    const body = { model: modelId, input: [] };
    assert.equal(applyDefaultReasoningEffort(body, modelId), body);
  });

  test(`${provider}/${modelId} uses Responses for translation and dispatch`, () => {
    assert.equal(getModelTargetFormat(provider, modelId), FORMATS.OPENAI_RESPONSES);
    assert.equal(resolveOpencodeTargetFormat(provider, modelId), FORMATS.OPENAI_RESPONSES);
  });
}

test("newly imported Muse versions keep the provider's Responses transport", () => {
  for (const provider of ["opencode", "opencode-zen", "opencode-go"]) {
    assert.equal(
      getModelTargetFormat(provider, "muse-spark-9.0-contributor"),
      FORMATS.OPENAI_RESPONSES
    );
  }
  assert.equal(getModelTargetFormat("openai", "muse-spark-9.0"), null);
  assert.equal(getModelTargetFormat("opencode-zen", "not-muse-spark"), null);
});

test("resolved xhigh alias reaches the Responses wire body, not a Chat-only field", () => {
  const body: Record<string, unknown> = { model: "muse-spark-1.3-contributor-free", input: [] };
  const result = applyDefaultReasoningEffort(
    body,
    String(body.model),
    "xhigh",
    null,
    FORMATS.OPENAI_RESPONSES
  );
  assert.deepEqual(result.reasoning, { effort: "xhigh" });
  assert.equal(result.reasoning_effort, undefined);
  assert.equal(body.reasoning, undefined);
});

test("Responses default does not override an explicit client effort", () => {
  const body = { model: "muse-spark-1.3", input: [], reasoning: { effort: "high" } };
  assert.equal(
    applyDefaultReasoningEffort(body, body.model, "xhigh", null, FORMATS.OPENAI_RESPONSES),
    body
  );
});

test("Responses summary preference does not swallow a selected effort alias", () => {
  const body: Record<string, unknown> = {
    model: "muse-spark-1.3",
    input: [],
    reasoning: { summary: "auto" },
  };
  const result = applyDefaultReasoningEffort(
    body,
    String(body.model),
    "xhigh",
    null,
    FORMATS.OPENAI_RESPONSES
  );
  assert.deepEqual(result.reasoning, { summary: "auto", effort: "xhigh" });
  assert.deepEqual(body.reasoning, { summary: "auto" });
});
