import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/download/route";
const video = Buffer.from([0,0,0,20,...Buffer.from("ftypisom"),0,0,0,0]).toString("base64");
const request = (origin: string, payload = video) => new Request("http://localhost:3000/api/download", { method: "POST", headers: { host: "127.0.0.1:3000", origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ video: payload, filename: 'demo"\r\n.mp4' }) });
test("MP4 download responds as an attachment without retaining server state", async () => {
 const response = await POST(request("http://127.0.0.1:3000"));
 assert.equal(response.status,200); assert.equal(response.headers.get("content-type"),"video/mp4");
 assert.equal(response.headers.get("content-disposition"),'attachment; filename="demo---.mp4"');
 assert.equal(response.headers.get("cache-control"),"no-store");
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(video,"base64"));
});
test("download rejects foreign origins and invalid media", async () => {
 assert.equal((await POST(request("https://other.example"))).status,403);
 assert.equal((await POST(request("http://127.0.0.1:3000","<script>"))).status,400);
});
