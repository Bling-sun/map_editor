import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Neural Tracker map editor", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Neural Tracker Map Studio<\/title>/i);
  assert.match(html, /⚡ 一键生成/);
  assert.match(html, /aspect-ratio:80 \/ 80/);
  assert.match(html, /neural_tracker 外墙/);
  assert.match(html, /TRACKER 起点/);
  assert.match(html, /TARGET 起点/);
  for (const label of ["矩形", "墙体", "圆柱", "L 型", "E 型", "T 型", "H 型", "S 型", "F 型", "棱台", "拱桥", "树状"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
});

test("generates and verifies non-overlapping layouts", async () => {
  const executable = new URL("../node_modules/.bin/tsx", import.meta.url).pathname;
  const script = `
    import { DEFAULT_GENERATOR_CONFIG, generateNonOverlappingMap, verifyGeneratedLayout } from "./app/map-generator.ts";
    const base = { mapWidth: 80, mapHeight: 80, boundaryThickness: 0.15, tracker: { x: -9.5, y: 0 }, target: { x: -7, y: 0 }, spacing: 0.35 };
    for (let index = 0; index < 50; index += 1) {
      const result = generateNonOverlappingMap({ ...base, config: DEFAULT_GENERATOR_CONFIG, snapGrid: 0.25 });
      if (!result.ok || result.obstacles.length !== 28 || !verifyGeneratedLayout(result.obstacles, base)) process.exit(1);
    }
  `;
  const { stderr } = await run(executable, ["-e", script], { cwd: projectRoot.pathname });
  assert.equal(stderr, "");
});
