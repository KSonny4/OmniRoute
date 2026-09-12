import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-muse-13-"));
process.env.DATA_DIR = dataDir;
process.env.API_KEY_SECRET = "muse-13-test-secret";

const core = await import("../../src/lib/db/core.ts");
const { createProviderConnection } = await import("../../src/lib/db/providers.ts");
const { persistDiscoveredModels } = await import("../../src/lib/providerModels/modelDiscovery.ts");
const { getModelInfo } = await import("../../src/sse/services/model.ts");
const { getUnifiedModelsResponse } = await import("../../src/app/api/v1/models/catalog.ts");
const { applyDefaultReasoningEffort } =
  await import("../../open-sse/services/defaultReasoningEffort.ts");
const { resolveChatCoreTargetFormat } =
  await import("../../open-sse/handlers/chatCore/targetFormat.ts");

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("bare live catalogs expose routable Muse xhigh aliases on both OpenCodes", async () => {
  const routes = [
    ["opencode-zen", "muse-spark-1.3"],
    ["opencode-zen", "muse-spark-1.3-contributor-free"],
    ["opencode-go", "muse-spark-1.3-contributor"],
  ];
  for (const provider of ["opencode-zen", "opencode-go"]) {
    const connection = await createProviderConnection({
      provider,
      authType: "apikey",
      name: provider,
      apiKey: "test-key",
      isActive: true,
      testStatus: "active",
    });
    await persistDiscoveredModels(
      provider,
      connection.id,
      routes.filter(([owner]) => owner === provider).map(([, id]) => ({ id }))
    );
  }
  const response = await getUnifiedModelsResponse(new Request("http://localhost/api/v1/models"));
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: Array<{ id: string; capabilities?: { tool_calling?: boolean } }>;
  };
  const models = new Map(payload.data.map((entry) => [entry.id, entry]));
  for (const [provider, modelId] of routes) {
    const alias = `${provider}/${modelId}-xhigh`;
    assert.ok(models.has(alias), `${alias} must be listed`);
    assert.equal(models.get(alias)?.capabilities?.tool_calling, true);
    const info = await getModelInfo(alias);
    assert.equal(info.model, modelId);
    assert.equal(info.resolvedThinkingEffort, "xhigh");
    const { targetFormat } = resolveChatCoreTargetFormat({
      provider,
      resolvedModel: info.model,
      apiFormat: undefined,
      customModelTargetFormat: undefined,
      providerSpecificData: undefined,
    });
    assert.equal(targetFormat, "openai-responses");
    const body: Record<string, unknown> = { model: info.model, input: [] };
    const upstream = applyDefaultReasoningEffort(
      body,
      info.model,
      info.resolvedThinkingEffort,
      info.defaultThinkingEffort,
      targetFormat
    );
    assert.deepEqual(upstream.reasoning, { effort: "xhigh" });
    if (modelId.includes("contributor")) {
      assert.equal(models.has(`${provider}/${modelId}-max`), false);
    }
  }
});
