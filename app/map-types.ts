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

export const COMPOSITE_SHAPES: Shape[] = [
  "l_shape", "e_shape", "t_shape", "h_shape", "s_shape", "f_shape",
];

export function isCompositeShape(shape: Shape) {
  return COMPOSITE_SHAPES.includes(shape);
}

export function clampedThickness(item: Pick<Obstacle, "thickness" | "width" | "depth">) {
  return Math.max(0.05, Math.min(item.thickness, item.width, item.depth));
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
