import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/chat/route";
import { initialProject } from "../src/lib/project";
const input = { prompt: "Make scene 2 last 6 seconds", project: initialProject, selectedId: "product", mode: "demo", assets: [], history: [] };
const request = (body: object) => new Request("http://localhost:3000/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("chat endpoint applies a local command and reports the actual engine", async () => {
  const response = await POST(request(input)); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.source, "demo"); assert.equal(result.project.scenes[1].duration, 6);
});
test("AI mode requires a key and does not silently substitute the demo engine", async () => {
  const saved = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  try { const response = await POST(request({ ...input, mode: "ai" })); assert.equal(response.status, 401); assert.match((await response.json()).error, /API key/); }
  finally { if (saved) process.env.OPENAI_API_KEY = saved; }
});
test("malformed and oversized chat requests fail with validation errors", async () => {
  assert.equal((await POST(request({ ...input, prompt: "" }))).status, 400);
  assert.equal((await POST(new Request("http://localhost:3000/api/chat", { method: "POST", headers: { "content-length": "100001", "content-type": "application/json" }, body: "{}" }))).status, 413);
});
test("AI transport sends schema, current state and selection; parsed changes survive", async () => {
  const originalFetch = globalThis.fetch;
  let observed: Record<string, unknown> | undefined;
  const project = structuredClone(initialProject); project.scenes[1].duration = 6;
  globalThis.fetch = async (_url, options) => {
    observed = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ id: "resp_test", object: "response", status: "completed", created_at: 1, model: "gpt-4.1", output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ message: "Held the product shot longer.", project }), annotations: [] }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await POST(request({ ...input, mode: "ai", apiKey: "test-key", model: "gpt-4.1" })); const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.source, "ai"); assert.equal(result.project.scenes[1].duration, 6);
    assert.equal(observed?.store, false); assert.match(JSON.stringify(observed?.input), /product/); assert.match(JSON.stringify(observed?.text), /json_schema/);
  } finally { globalThis.fetch = originalFetch; }
});

test("another website cannot invoke the local model endpoint", async () => {
  const response = await POST(new Request("http://localhost:3000/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other-site.example" }, body: JSON.stringify(input) }));
  assert.equal(response.status, 403);
  assert.equal((await POST(new Request("http://localhost:3000/api/chat", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(input) }))).status, 415);
});

test("same-origin checks use the browser host when Next normalizes its internal URL", async () => {
  const response = await POST(new Request("http://localhost:3000/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000", Host: "127.0.0.1:3000" }, body: JSON.stringify(input) }));
  assert.equal(response.status, 200);
});
