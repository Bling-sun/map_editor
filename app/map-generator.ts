import type { Obstacle, Shape } from "./map-types";

export type ShapeGenerationOptions = {
  enabled: boolean;
  count: number;
  minSize: number;
  maxSize: number;
  minHeight: number;
  maxHeight: number;
  minThickness: number;
  maxThickness: number;
};

export type GeneratorConfig = Record<Shape, ShapeGenerationOptions>;

export type GenerateMapOptions = {
  config: GeneratorConfig;
  mapWidth: number;
  mapHeight: number;
  boundaryThickness: number;
  tracker: { x: number; y: number };
  target: { x: number; y: number };
  spacing: number;
  snapGrid?: number | null;
  random?: () => number;
};

export type GenerationResult =
  | { ok: true; obstacles: Obstacle[] }
  | { ok: false; error: string };

const SHAPE_NAMES: Record<Shape, string> = {
  box: "矩形",
  wall: "墙体",
  cylinder: "圆柱",
  l_shape: "L 型",
  e_shape: "E 型",
  t_shape: "T 型",
  h_shape: "H 型",
  s_shape: "S 型",
  f_shape: "F 型",
  frustum: "棱台",
  arch: "拱桥",
  tree: "树状",
};

const option = (
  enabled: boolean,
  count: number,
  minSize: number,
  maxSize: number,
  minHeight: number,
  maxHeight: number,
  minThickness = 0,
  maxThickness = 0,
): ShapeGenerationOptions => ({ enabled, count, minSize, maxSize, minHeight, maxHeight, minThickness, maxThickness });

const THICKNESS_SHAPES: Shape[] = ["wall", "l_shape", "e_shape", "t_shape", "h_shape", "s_shape", "f_shape", "arch"];

export function supportsGeneratedThickness(shape: Shape) {
  return THICKNESS_SHAPES.includes(shape);
}

export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  box: option(true, 6, 0.8, 2.5, 0.6, 1.8),
  wall: option(true, 6, 2.5, 6, 1, 2, 0.18, 0.45),
  cylinder: option(true, 8, 0.6, 1.8, 0.8, 2.2),
  l_shape: option(false, 3, 2.5, 5, 1, 2, 0.18, 0.5),
  e_shape: option(false, 2, 3, 5.5, 1, 2, 0.18, 0.5),
  t_shape: option(false, 3, 2.5, 5, 1, 2, 0.18, 0.5),
  h_shape: option(false, 2, 3, 5.5, 1, 2, 0.18, 0.5),
  s_shape: option(false, 2, 3, 5.5, 1, 2, 0.18, 0.5),
  f_shape: option(false, 2, 3, 5.5, 1, 2, 0.18, 0.5),
  frustum: option(false, 4, 1.2, 3, 0.8, 2.5),
  arch: option(false, 3, 2.5, 5, 2, 3.5, 0.2, 0.55),
  tree: option(true, 8, 1.2, 3, 2.2, 4.5),
};

const randomBetween = (min: number, max: number, random: () => number) => min + (max - min) * random();
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const uid = () => `generated-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

function makeObstacle(shape: Shape, index: number, settings: ShapeGenerationOptions, random: () => number): Obstacle {
  const size = randomBetween(settings.minSize, settings.maxSize, random);
  const secondSize = randomBetween(settings.minSize, settings.maxSize, random);
  const height = randomBetween(settings.minHeight, settings.maxHeight, random);
  const generatedThickness = supportsGeneratedThickness(shape)
    ? randomBetween(settings.minThickness, settings.maxThickness, random)
    : 0.3;
  let width = size;
  let depth = secondSize;
  let radius = Math.max(0.08, size / 2);
  let crownRadius = Math.max(radius, size / 2);

  if (shape === "wall") depth = generatedThickness;
  if (shape === "cylinder") width = depth = size;
  if (shape === "arch") depth = Math.max(generatedThickness, Math.max(0.35, Math.min(1.2, size * randomBetween(0.14, 0.28, random))));
  if (shape === "tree") {
    width = depth = size;
    crownRadius = size / 2;
    radius = Math.max(0.1, Math.min(crownRadius * 0.34, size * randomBetween(0.08, 0.14, random)));
  }

  const thickness = supportsGeneratedThickness(shape) ? generatedThickness : Math.min(0.3, width, depth);
  const clearance = Math.max(0.25, Math.min(height - 0.1, height * randomBetween(0.55, 0.72, random)));

  return {
    id: uid(),
    name: `${SHAPE_NAMES[shape]} ${String(index + 1).padStart(2, "0")}`,
    shape,
    x: 0,
    y: 0,
    angle: rounded(randomBetween(-180, 180, random)),
    width: rounded(width),
    depth: rounded(depth),
    height: rounded(height),
    thickness: rounded(thickness),
    radius: rounded(radius),
    topScale: rounded(randomBetween(0.4, 0.76, random)),
    clearance: rounded(clearance),
    crownRadius: rounded(crownRadius),
  };
}

/** A conservative radius enclosing the complete XY footprint at every rotation. */
export function obstacleCollisionRadius(obstacle: Obstacle) {
  if (obstacle.shape === "cylinder") return obstacle.radius;
  if (obstacle.shape === "tree") return Math.max(obstacle.radius, obstacle.crownRadius);
  return Math.hypot(obstacle.width, obstacle.depth) / 2;
}

function isSeparated(x: number, y: number, radius: number, other: { x: number; y: number; radius: number }, spacing: number) {
  return Math.hypot(x - other.x, y - other.y) + 1e-9 >= radius + other.radius + spacing;
}

function validateConfiguration(config: GeneratorConfig, spacing: number) {
  const selected = Object.entries(config).filter(([, value]) => value.enabled) as [Shape, ShapeGenerationOptions][];
  if (!selected.length) return "请至少选择一种元素类型。";
  if (!Number.isFinite(spacing) || spacing < 0 || spacing > 10) return "元素间距应在 0–10 米之间。";
  let total = 0;
  for (const [shape, value] of selected) {
    if (!Number.isInteger(value.count) || value.count < 0) return `${SHAPE_NAMES[shape]}的数量必须是非负整数。`;
    if (value.minSize <= 0 || value.maxSize < value.minSize) return `${SHAPE_NAMES[shape]}的尺寸范围无效。`;
    if (value.minHeight <= 0 || value.maxHeight < value.minHeight) return `${SHAPE_NAMES[shape]}的高度范围无效。`;
    if (supportsGeneratedThickness(shape)) {
      if (value.minThickness <= 0 || value.maxThickness < value.minThickness) return `${SHAPE_NAMES[shape]}的厚度范围无效。`;
      const thicknessLimit = shape === "arch" ? value.minSize / 3 : value.minSize;
      if (value.maxThickness > thicknessLimit) return `${SHAPE_NAMES[shape]}的最大厚度不能超过 ${rounded(thicknessLimit)} 米。`;
    }
    total += value.count;
  }
  if (!total) return "已选元素的数量不能全部为 0。";
  if (total > 200) return "单次最多生成 200 个元素。";
  return null;
}

export function verifyGeneratedLayout(
  obstacles: Obstacle[],
  options: Pick<GenerateMapOptions, "mapWidth" | "mapHeight" | "boundaryThickness" | "tracker" | "target" | "spacing">,
) {
  const protectedPoints = [options.tracker, options.target].map((point) => ({ ...point, radius: 1 }));
  for (let index = 0; index < obstacles.length; index += 1) {
    const item = obstacles[index];
    const radius = obstacleCollisionRadius(item);
    const horizontalLimit = options.mapWidth / 2 - options.boundaryThickness - options.spacing;
    const verticalLimit = options.mapHeight / 2 - options.boundaryThickness - options.spacing;
    if (![item.x, item.y, radius].every(Number.isFinite)) return false;
    if (Math.abs(item.x) + radius > horizontalLimit + 1e-7 || Math.abs(item.y) + radius > verticalLimit + 1e-7) return false;
    if (protectedPoints.some((point) => !isSeparated(item.x, item.y, radius, point, options.spacing))) return false;
    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      const other = obstacles[otherIndex];
      if (!isSeparated(item.x, item.y, radius, { x: other.x, y: other.y, radius: obstacleCollisionRadius(other) }, options.spacing)) return false;
    }
  }
  return true;
}

export function generateNonOverlappingMap(options: GenerateMapOptions): GenerationResult {
  const configurationError = validateConfiguration(options.config, options.spacing);
  if (configurationError) return { ok: false, error: configurationError };
  const random = options.random ?? Math.random;
  const candidates = (Object.entries(options.config) as [Shape, ShapeGenerationOptions][]).flatMap(([shape, settings]) => {
    if (!settings.enabled) return [];
    return Array.from({ length: settings.count }, (_, index) => makeObstacle(shape, index, settings, random));
  }).sort((left, right) => obstacleCollisionRadius(right) - obstacleCollisionRadius(left));

  const placed: Obstacle[] = [];
  const occupied: { x: number; y: number; radius: number }[] = [
    { ...options.tracker, radius: 1 },
    { ...options.target, radius: 1 },
  ];

  for (const candidate of candidates) {
    const radius = obstacleCollisionRadius(candidate);
    const minX = Math.ceil((-options.mapWidth / 2 + options.boundaryThickness + options.spacing + radius) * 1000) / 1000;
    const maxX = Math.floor((options.mapWidth / 2 - options.boundaryThickness - options.spacing - radius) * 1000) / 1000;
    const minY = Math.ceil((-options.mapHeight / 2 + options.boundaryThickness + options.spacing + radius) * 1000) / 1000;
    const maxY = Math.floor((options.mapHeight / 2 - options.boundaryThickness - options.spacing - radius) * 1000) / 1000;
    if (minX > maxX || minY > maxY) {
      return { ok: false, error: `${candidate.name} 的尺寸超过当前地图可用范围，请减小尺寸。` };
    }

    let position: { x: number; y: number } | null = null;
    for (let attempt = 0; attempt < 3000; attempt += 1) {
      let x = randomBetween(minX, maxX, random);
      let y = randomBetween(minY, maxY, random);
      if (options.snapGrid && options.snapGrid > 0) {
        x = Math.max(minX, Math.min(maxX, Math.round(x / options.snapGrid) * options.snapGrid));
        y = Math.max(minY, Math.min(maxY, Math.round(y / options.snapGrid) * options.snapGrid));
      }
      x = rounded(x);
      y = rounded(y);
      if (occupied.every((other) => isSeparated(x, y, radius, other, options.spacing))) {
        position = { x, y };
        break;
      }
    }
    if (!position) {
      return { ok: false, error: `无法在不重叠的条件下放置 ${candidate.name}。请减少数量、尺寸或元素间距。` };
    }
    const item = { ...candidate, ...position };
    placed.push(item);
    occupied.push({ ...position, radius });
  }

  if (!verifyGeneratedLayout(placed, options)) {
    return { ok: false, error: "安全校验未通过，原地图未被修改，请重新生成。" };
  }
  return { ok: true, obstacles: placed };
}
