import assert from "node:assert/strict";
import test from "node:test";
import { createChatPipelineHarness } from "../integration/_chatPipelineHarness.ts";

const harness = await createChatPipelineHarness("muse-13-pipeline");
const { createProviderConnection } = await import("../../src/lib/db/providers.ts");
const { persistDiscoveredModels } = await import("../../src/lib/providerModels/modelDiscovery.ts");
const { createCombo } = await import("../../src/lib/db/combos.ts");

test.after(() => harness.cleanup());

test("Gemini 3.8 leaves the documented medium default intact", async () => {
  await harness.resetStorage();
  const connection = await createProviderConnection({
    provider: "gemini",
    authType: "apikey",
    apiKey: "test-key",
    name: "gemini-test",
    isActive: true,
    testStatus: "active",
  });
  await persistDiscoveredModels("gemini", connection.id, [
    { id: "gemini-3.8-flash", supportsThinking: true },
  ]);
  let captured: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    assert.ok(request.url.startsWith("https://generativelanguage.googleapis.com/"));
    captured = await request.json();
    return new Response(
      JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
      { headers: { "content-type": "application/json" } }
    );
  };
  const response = await harness.handleChat(
    harness.buildRequest({
      body: {
        model: "gemini/gemini-3.8-flash",
        stream: false,
        messages: [{ role: "user", content: "Check medium default" }],
      },
    })
  );
  await response.text();
  assert.equal(response.status, 200);
  const thinking = (
    captured.generationConfig as {
      thinkingConfig?: { thinkingBudget?: number; thinkingLevel?: string };
    }
  )?.thinkingConfig;
  assert.equal(thinking?.thinkingBudget, undefined);
  assert.ok(
    thinking?.thinkingLevel === undefined || thinking.thinkingLevel.toLowerCase() === "medium"
  );
});

test("direct and combo Muse xhigh aliases retain effort through the complete dispatch pipeline", async () => {
  await harness.resetStorage();
  await harness.settingsDb.updateSettings({ requestRetry: 0, maxRetryIntervalSec: 0 });
  const model = "muse-spark-1.3-contributor-free";
  const route = `opencode-zen/${model}-xhigh`;
  const connection = await createProviderConnection({
    provider: "opencode-zen",
    authType: "apikey",
    apiKey: "test-key",
    name: "muse-test",
    isActive: true,
    testStatus: "active",
  });
  await persistDiscoveredModels("opencode-zen", connection.id, [{ id: model }]);
  await createCombo({
    name: "muse-test-pack",
    strategy: "priority",
    models: [{ model: route, providerId: "opencode-zen", connectionId: connection.id }],
  });
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    assert.equal(request.url, "https://opencode.ai/zen/v1/responses");
    captured.push({ url: request.url, body: await request.json() });
    return new Response(
      JSON.stringify({
        id: "resp_muse_test",
        object: "response",
        model,
        status: "completed",
        output: [
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }),
      { headers: { "content-type": "application/json" } }
    );
  };
  for (const selected of [route, "muse-test-pack"]) {
    const response = await harness.handleChat(
      harness.buildRequest({
        body: {
          model: selected,
          stream: false,
          max_tokens: 1024,
          messages: [{ role: "user", content: `Check ${selected}` }],
        },
      })
    );
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(captured.at(-1)?.body.model, model);
    assert.deepEqual(captured.at(-1)?.body.reasoning, { effort: "xhigh" });
  }
});
