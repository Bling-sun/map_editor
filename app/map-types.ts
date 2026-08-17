export type Shape =
  | "box" | "wall" | "cylinder" | "l_shape"
  | "e_shape" | "t_shape" | "h_shape" | "s_shape" | "f_shape"
  | "frustum" | "arch" | "tree";

export type Obstacle = {
  id: string;
  name: string;
  shape: Shape;
  x: number;
  y: number;
  angle: number;
  width: number;
  depth: number;
  height: number;
  thickness: number;
  radius: number;
  topScale: number;
  clearance: number;
  crownRadius: number;
};

export type LocalRect = { x: number; y: number; width: number; depth: number };

export type MapRect = { minX: number; maxX: number; minY: number; maxY: number };

type DuplicateOptions = {
  mapWidth: number;
  mapHeight: number;
  offset: number;
  createId: () => string;
};

export const COMPOSITE_SHAPES: Shape[] = [
  "l_shape", "e_shape", "t_shape", "h_shape", "s_shape", "f_shape",
];

export function isCompositeShape(shape: Shape) {
  return COMPOSITE_SHAPES.includes(shape);
}

export function clampedThickness(item: Pick<Obstacle, "thickness" | "width" | "depth">) {
  return Math.max(0.05, Math.min(item.thickness, item.width, item.depth));
}

export function obstacleFootprint(item: Obstacle) {
  if (item.shape === "cylinder") return { width: item.radius * 2, depth: item.radius * 2 };
  if (item.shape === "tree") return { width: item.crownRadius * 2, depth: item.crownRadius * 2 };
  return { width: item.width, depth: item.depth };
}

export function obstacleBounds(item: Obstacle): MapRect {
  const footprint = obstacleFootprint(item);
  const angle = item.angle * Math.PI / 180;
  const halfX = Math.abs(Math.cos(angle)) * footprint.width / 2 + Math.abs(Math.sin(angle)) * footprint.depth / 2;
  const halfY = Math.abs(Math.sin(angle)) * footprint.width / 2 + Math.abs(Math.cos(angle)) * footprint.depth / 2;
  return { minX: item.x - halfX, maxX: item.x + halfX, minY: item.y - halfY, maxY: item.y + halfY };
}

export function obstacleGroupBounds(items: Obstacle[]): MapRect | null {
  if (!items.length) return null;
  const bounds = items.map(obstacleBounds);
  return {
    minX: Math.min(...bounds.map((item) => item.minX)),
    maxX: Math.max(...bounds.map((item) => item.maxX)),
    minY: Math.min(...bounds.map((item) => item.minY)),
    maxY: Math.max(...bounds.map((item) => item.maxY)),
  };
}

/** Clamp a shared translation so a group keeps its layout and remains in the map. */
export function constrainGroupTranslation(items: Obstacle[], mapWidth: number, mapHeight: number, x: number, y: number) {
  const bounds = obstacleGroupBounds(items);
  if (!bounds) return { x: 0, y: 0 };
  const clamp = (value: number, min: number, max: number) => min <= max
    ? Math.max(min, Math.min(max, value))
    : 0;
  return {
    x: clamp(x, -mapWidth / 2 - bounds.minX, mapWidth / 2 - bounds.maxX),
    y: clamp(y, -mapHeight / 2 - bounds.minY, mapHeight / 2 - bounds.maxY),
  };
}

/** Conservative rotated XY bounds used by the 2D marquee selector. */
export function obstacleIntersectsRect(item: Obstacle, rect: MapRect) {
  const bounds = obstacleBounds(item);
  return bounds.maxX >= rect.minX && bounds.minX <= rect.maxX
    && bounds.maxY >= rect.minY && bounds.minY <= rect.maxY;
}

/** Duplicate selected obstacles while preserving their relative layout inside the map. */
export function duplicateObstacles(obstacles: Obstacle[], selectedIds: Iterable<string>, options: DuplicateOptions) {
  const selected = new Set(selectedIds);
  const source = obstacles.filter((item) => selected.has(item.id));
  if (!source.length) return [];

  const distance = Math.max(0, options.offset);
  const candidates = [[distance, -distance], [distance, distance], [-distance, -distance], [-distance, distance]] as const;
  const translation = candidates.map(([x, y]) => constrainGroupTranslation(source, options.mapWidth, options.mapHeight, x, y))
    .reduce((best, next) => next.x ** 2 + next.y ** 2 > best.x ** 2 + best.y ** 2 ? next : best);

  const names = new Set(obstacles.map((item) => item.name));
  const nextName = (name: string) => {
    const original = name.replace(/ 副本(?: \d+)?$/, "");
    let copy = `${original} 副本`;
    let index = 2;
    while (names.has(copy)) copy = `${original} 副本 ${index++}`;
    names.add(copy);
    return copy;
  };
  const rounded = (value: number) => Math.round(value * 1000) / 1000;

  return source.map((item) => ({
    ...item,
    id: options.createId(),
    name: nextName(item.name),
    x: rounded(item.x + translation.x),
    y: rounded(item.y + translation.y),
  }));
}

/** Rotate selected obstacles as a rigid group around the center of their positions. */
export function rotateObstacleGroup(obstacles: Obstacle[], selectedIds: Iterable<string>, degrees: number, mapWidth: number, mapHeight: number) {
  const selected = new Set(selectedIds);
  const source = obstacles.filter((item) => selected.has(item.id));
  if (!source.length || !Number.isFinite(degrees)) return [];
  const center = {
    x: (Math.min(...source.map((item) => item.x)) + Math.max(...source.map((item) => item.x))) / 2,
    y: (Math.min(...source.map((item) => item.y)) + Math.max(...source.map((item) => item.y))) / 2,
  };
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const normalizeAngle = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
  const rounded = (value: number) => Math.round(value * 1000) / 1000;
  const rotated = source.map((item) => {
    const localX = item.x - center.x;
    const localY = item.y - center.y;
    return {
      ...item,
      x: rounded(center.x + localX * cos - localY * sin),
      y: rounded(center.y + localX * sin + localY * cos),
      angle: rounded(normalizeAngle(item.angle + degrees)),
    };
  });
  const correction = constrainGroupTranslation(rotated, mapWidth, mapHeight, 0, 0);
  return rotated.map((item) => ({ ...item, x: rounded(item.x + correction.x), y: rounded(item.y + correction.y) }));
}

export function localRects(item: Obstacle): LocalRect[] {
  const w = item.width;
  const d = item.depth;
  const t = clampedThickness(item);
  const left = -(w - t) / 2;
  const right = (w - t) / 2;
  const top = (d - t) / 2;
  const bottom = -(d - t) / 2;
  switch (item.shape) {
    case "l_shape":
      return [{ x: 0, y: bottom, width: w, depth: t }, { x: left, y: 0, width: t, depth: d }];
    case "e_shape":
      return [
        { x: left, y: 0, width: t, depth: d },
        { x: 0, y: top, width: w, depth: t },
        { x: 0, y: 0, width: w, depth: t },
        { x: 0, y: bottom, width: w, depth: t },
      ];
    case "t_shape":
      return [
        { x: 0, y: top, width: w, depth: t },
        { x: 0, y: -(t / 2), width: t, depth: Math.max(t, d - t) },
      ];
    case "h_shape":
      return [
        { x: left, y: 0, width: t, depth: d },
        { x: right, y: 0, width: t, depth: d },
        { x: 0, y: 0, width: w, depth: t },
      ];
    case "s_shape": {
      const connectorDepth = Math.max(t, (d - 3 * t) / 2 + t);
      return [
        { x: 0, y: top, width: w, depth: t },
        { x: 0, y: 0, width: w, depth: t },
        { x: 0, y: bottom, width: w, depth: t },
        { x: left, y: d / 4, width: t, depth: connectorDepth },
        { x: right, y: -d / 4, width: t, depth: connectorDepth },
      ];
    }
    case "f_shape":
      return [
        { x: left, y: 0, width: t, depth: d },
        { x: 0, y: top, width: w, depth: t },
        { x: 0, y: 0, width: w, depth: t },
      ];
    case "arch":
      return [
        { x: left, y: 0, width: t, depth: d },
        { x: right, y: 0, width: t, depth: d },
      ];
    default:
      return [{ x: 0, y: 0, width: w, depth: d }];
  }
}
