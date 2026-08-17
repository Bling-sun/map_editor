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
  assert.match(html, /▱ 框选/);
  assert.match(html, /aspect-ratio:80 \/ 80/);
  assert.match(html, /neural_tracker 外墙/);
  assert.match(html, /外墙厚度/);
  assert.match(html, /外墙高度/);
  assert.match(html, /TRACKER 起点/);
  assert.match(html, /TARGET 起点/);
  for (const label of ["矩形", "墙体", "圆柱", "L 型", "E 型", "T 型", "H 型", "S 型", "F 型", "棱台", "拱桥", "树状"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
});

test("generates and verifies non-overlapping layouts", async () => {
  const executable = new URL("../node_modules/.bin/tsx", import.meta.url).pathname;
  const script = `
    import { DEFAULT_GENERATOR_CONFIG, GENERATED_ANGLES, generateNonOverlappingMap, verifyGeneratedLayout } from "./app/map-generator.ts";
    const base = { mapWidth: 80, mapHeight: 80, boundaryThickness: 0.15, tracker: { x: -9.5, y: 0 }, target: { x: -7, y: 0 }, spacing: 0.35 };
    for (let index = 0; index < 50; index += 1) {
      const result = generateNonOverlappingMap({ ...base, config: DEFAULT_GENERATOR_CONFIG, snapGrid: 0.25 });
      if (!result.ok || result.obstacles.length !== 28 || !verifyGeneratedLayout(result.obstacles, base)) process.exit(1);
      if (result.obstacles.some((item) => !GENERATED_ANGLES.includes(item.angle))) process.exit(1);
      const walls = result.obstacles.filter((item) => item.shape === "wall");
      if (walls.some((item) => item.thickness < 0.18 || item.thickness > 0.45 || item.depth !== item.thickness)) process.exit(1);
    }
    const config = Object.fromEntries(Object.entries(DEFAULT_GENERATOR_CONFIG).map(([shape, value]) => [shape, { ...value, enabled: shape === "l_shape", count: shape === "l_shape" ? 20 : value.count, minThickness: 0.31, maxThickness: 0.32 }]));
    const composite = generateNonOverlappingMap({ ...base, config, snapGrid: 0.25 });
    if (!composite.ok || composite.obstacles.some((item) => item.thickness < 0.31 || item.thickness > 0.32)) process.exit(1);
  `;
  const { stderr } = await run(executable, ["-e", script], { cwd: projectRoot.pathname });
  assert.equal(stderr, "");
});

test("marquee intersection includes rotated obstacle bounds", async () => {
  const executable = new URL("../node_modules/.bin/tsx", import.meta.url).pathname;
  const script = `
    import { obstacleIntersectsRect } from "./app/map-types.ts";
    const obstacle = { id: "test", name: "test", shape: "box", x: 2, y: 3, angle: 45, width: 4, depth: 2, height: 1, thickness: 0.2, radius: 1, topScale: 0.5, clearance: 1, crownRadius: 1 };
    if (!obstacleIntersectsRect(obstacle, { minX: 3.9, maxX: 4.2, minY: 2.8, maxY: 3.2 })) process.exit(1);
    if (obstacleIntersectsRect(obstacle, { minX: 8, maxX: 9, minY: 8, maxY: 9 })) process.exit(1);
  `;
  const { stderr } = await run(executable, ["-e", script], { cwd: projectRoot.pathname });
  assert.equal(stderr, "");
});

test("duplicates a multi-selection as one in-bounds group", async () => {
  const executable = new URL("../node_modules/.bin/tsx", import.meta.url).pathname;
  const script = `
    import { duplicateObstacles, obstacleBounds } from "./app/map-types.ts";
    const preset = { shape: "box", angle: 0, width: 2, depth: 2, height: 1, thickness: .2, radius: 1, topScale: .5, clearance: 1, crownRadius: 1 };
    const obstacles = [
      { ...preset, id: "a", name: "A", x: 3, y: -3 },
      { ...preset, id: "b", name: "B", x: 1, y: -1 },
      { ...preset, id: "c", name: "C", x: -3, y: 3 },
    ];
    let id = 0;
    const copies = duplicateObstacles(obstacles, ["a", "b"], { mapWidth: 10, mapHeight: 10, offset: 2, createId: () => \`copy-\${++id}\` });
    if (copies.length !== 2 || copies[0].id === "a" || copies[1].id === "b") process.exit(1);
    const dx = copies[0].x - obstacles[0].x, dy = copies[0].y - obstacles[0].y;
    if (copies[1].x - obstacles[1].x !== dx || copies[1].y - obstacles[1].y !== dy) process.exit(1);
    if (!copies.every((item) => { const bounds = obstacleBounds(item); return bounds.minX >= -5 && bounds.maxX <= 5 && bounds.minY >= -5 && bounds.maxY <= 5; })) process.exit(1);
    const again = duplicateObstacles([...obstacles, ...copies], copies.map((item) => item.id), { mapWidth: 10, mapHeight: 10, offset: 2, createId: () => \`again-\${++id}\` });
    if (again[0].name !== "A 副本 2" || again[1].name !== "B 副本 2") process.exit(1);
  `;
  const { stderr } = await run(executable, ["-e", script], { cwd: projectRoot.pathname });
  assert.equal(stderr, "");
});

test("moves and rotates a selected obstacle group rigidly", async () => {
  const executable = new URL("../node_modules/.bin/tsx", import.meta.url).pathname;
  const script = `
    import { constrainGroupTranslation, obstacleBounds, rotateObstacleGroup } from "./app/map-types.ts";
    const preset = { shape: "box", angle: 0, width: 2, depth: 1, height: 1, thickness: .2, radius: 1, topScale: .5, clearance: 1, crownRadius: 1 };
    const obstacles = [
      { ...preset, id: "a", name: "A", x: -2, y: 0 },
      { ...preset, id: "b", name: "B", x: 2, y: 0 },
    ];
    const move = constrainGroupTranslation(obstacles, 10, 10, 8, 3);
    if (move.x !== 2 || move.y !== 3) process.exit(1);
    const rotated = rotateObstacleGroup(obstacles, ["a", "b"], 90, 10, 10);
    if (rotated.length !== 2 || rotated[0].x !== 0 || rotated[0].y !== -2 || rotated[1].x !== 0 || rotated[1].y !== 2) process.exit(1);
    if (rotated.some((item) => item.angle !== 90)) process.exit(1);
    if (!rotated.every((item) => { const bounds = obstacleBounds(item); return bounds.minX >= -5 && bounds.maxX <= 5 && bounds.minY >= -5 && bounds.maxY <= 5; })) process.exit(1);
  `;
  const { stderr } = await run(executable, ["-e", script], { cwd: projectRoot.pathname });
  assert.equal(stderr, "");
});
