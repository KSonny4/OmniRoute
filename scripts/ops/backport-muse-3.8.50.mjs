import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";

const [baseline, output] = process.argv.slice(2);
assert.ok(
  baseline && output,
  "Usage: node backport-muse-3.8.50.mjs <extracted package> <output dir>"
);
assert.equal(fs.readFileSync(path.join(baseline, "dist/BUILD_SHA"), "utf8").trim(), "dea6bb8");
const counts = { transport: 0, registry: 0, helper: 0, dispatch: 0, max: 0 };
const files = [];
const sha256 = (body) => crypto.createHash("sha256").update(body).digest("hex");
const newHelper = `function(body,modelId,suffixEffort,syncedDefaultEffort,targetFormat="openai") {
  if (!body || typeof body !== "object") return body;
  const reasoning = targetFormat === "openai-responses" && body.reasoning !== null && typeof body.reasoning === "object" && !Array.isArray(body.reasoning) ? body.reasoning : undefined;
  if (body.reasoning_effort !== undefined || body.thinking !== undefined || (reasoning ? reasoning.effort !== undefined : body.reasoning !== undefined)) return body;
  const effort = suffixEffort || (0,t.getModelSpec)(modelId)?.defaultReasoningEffort || syncedDefaultEffort;
  if (!effort) return body;
  return targetFormat === "openai-responses" ? {...body,reasoning:{...reasoning,effort}} : {...body,reasoning_effort:effort};
}`;

const helperContext = { t: { getModelSpec: () => undefined } };
const compiledHelper = vm.runInNewContext(`(${newHelper})`, helperContext);
for (const reasoning of [undefined, {}, { summary: "auto" }, { effort: "high" }]) {
  const body = { input: [], ...(reasoning === undefined ? {} : { reasoning }) };
  const result = compiledHelper(body, "muse-spark-1.3", "xhigh", null, "openai-responses");
  assert.equal(result.reasoning.effort, reasoning?.effort ?? "xhigh");
  assert.equal(result.reasoning.summary, reasoning?.summary);
  assert.equal(result.reasoning_effort, undefined);
  assert.equal(body.reasoning, reasoning);
}
assert.equal(compiledHelper({}, "muse-spark-1.3", "xhigh").reasoning_effort, "xhigh");

for (const entry of fs.readdirSync(path.join(baseline, "dist/.build/next/server/chunks"), {
  recursive: true,
})) {
  if (!entry.endsWith(".js")) continue;
  const relative = `dist/.build/next/server/chunks/${entry}`;
  const before = fs.readFileSync(path.join(baseline, relative), "utf8");
  let after = before.replace(
    /("getModelTargetFormat",0,function\([^]*?)("openai"===([\w$]+)&&\/-pro\$\/i\.test\(([\w$]+)\))/,
    (whole, prefix, fallback, alias, model) => {
      counts.transport++;
      return `${prefix}["oc","opencode-zen","opencode-go"].includes(${alias})&&/^muse-spark(?:-|$)/.test(${model})?"openai-responses":${fallback}`;
    }
  );
  after = after.replace(
    /\{id:"muse-spark-1\.2(?:-contributor(?:-free)?)?",name:"Muse Spark 1\.2[^]*?\}/g,
    (oldRow) => {
      counts.registry++;
      const contributor = oldRow.includes("contributor");
      const free = oldRow.includes("contributor-free");
      const model = `muse-spark-1.3${contributor ? "-contributor" : ""}${free ? "-free" : ""}`;
      const name = `Muse Spark 1.3${contributor ? " Contributor" : ""}${free ? " Free" : ""}`;
      const efforts = [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        ...(!contributor ? ["max"] : []),
      ];
      return `${oldRow},${JSON.stringify({ id: model, name, supportsReasoning: true, supportedThinkingEfforts: efforts, targetFormat: "openai-responses" })}`;
    }
  );
  after = after.replace(
    /((?:619661|908333),e=>\{"use strict";var t=e\.i\(\d+\);)[^]*?(?=\},\d+,e=>)/g,
    (whole, prefix) => {
      assert.ok(whole.includes('"applyDefaultReasoningEffort"'));
      counts.helper++;
      return `${prefix}e.s(["applyDefaultReasoningEffort",0,${newHelper}])`;
    }
  );
  after = after.replace(
    /([\w$]+)===([\w$]+)\.FORMATS\.OPENAI&&\(([\w$]+)=\(0,([\w$]+)\.applyDefaultReasoningEffort\)\(([^()]+)\)\)/g,
    (whole, target, formats, body, helper, args) => {
      assert.ok(args.includes("resolvedThinkingEffort") && args.includes("defaultThinkingEffort"));
      counts.dispatch++;
      return `(${target}===${formats}.FORMATS.OPENAI||${target}===${formats}.FORMATS.OPENAI_RESPONSES)&&(${body}=(0,${helper}.applyDefaultReasoningEffort)(${args},${target}))`;
    }
  );
  after = after.replace(
    /("normalizeResponsesReasoningEffort",0,function\([^]*?)([\w$]+)\.test\(([\w$]+)\)\|\|/,
    (whole, prefix, pattern, normalized) => {
      counts.max++;
      return `${prefix}/^(?:(?:opencode|opencode-zen|oc)\\/)?muse-spark-1\\.3$/.test(${normalized})||${pattern}.test(${normalized})||`;
    }
  );
  if (after === before) continue;
  new vm.Script(after, { filename: relative });
  const destination = path.join(output, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, after);
  files.push({ path: relative, before: sha256(before), after: sha256(after) });
}
assert.deepEqual(counts, { transport: 41, registry: 45, helper: 4, dispatch: 4, max: 6 });
const manifest = { version: "3.8.50", build: "dea6bb8", counts, files };
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    counts,
    changedFiles: files.length,
    manifest: path.join(output, "manifest.json"),
  })
);
