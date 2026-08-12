"use client";

import { ChangeEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGenerator from "./MapGenerator";
import ThreePreview from "./ThreePreview";
import { generateNonOverlappingMap, GeneratorConfig } from "./map-generator";
import { Obstacle, Shape, clampedThickness, isCompositeShape, localRects } from "./map-types";

type MapFile = {
  format: "neural-tracker-map";
  version: 1;
  name: string;
  map: { width: number; height: number; resolution: number };
  boundary: { enabled: boolean; thickness: number; height: number };
  tracker: { x: number; y: number; yaw: number };
  target: { x: number; y: number; yaw: number };
  obstacles: Obstacle[];
};

const SHAPES: { id: Shape; title: string; hint: string; glyph: string }[] = [
  { id: "box", title: "矩形", hint: "箱体 / 建筑", glyph: "▰" },
  { id: "wall", title: "墙体", hint: "长墙 / 隔断", glyph: "▬" },
  { id: "cylinder", title: "圆柱", hint: "树干 / 柱体", glyph: "●" },
  { id: "l_shape", title: "L 型", hint: "转角 / 围挡", glyph: "┗" },
  { id: "e_shape", title: "E 型", hint: "三通道墙", glyph: "E" },
  { id: "t_shape", title: "T 型", hint: "丁字隔断", glyph: "T" },
  { id: "h_shape", title: "H 型", hint: "双墙连接", glyph: "H" },
  { id: "s_shape", title: "S 型", hint: "回转通道", glyph: "S" },
  { id: "f_shape", title: "F 型", hint: "双岔隔断", glyph: "F" },
  { id: "frustum", title: "棱台", hint: "收口台体", glyph: "◆" },
  { id: "arch", title: "拱桥", hint: "可通行门洞", glyph: "∩" },
  { id: "tree", title: "树状", hint: "树干与树冠", glyph: "♣" },
];

const preset = (values: Partial<Omit<Obstacle, "id" | "name" | "shape" | "x" | "y">>) => ({
  width: 3, depth: 3, height: 1.5, thickness: 0.3, radius: 0.35,
  topScale: 0.55, clearance: 1.4, crownRadius: 1.1, angle: 0, ...values,
});

const PRESETS: Record<Shape, Omit<Obstacle, "id" | "name" | "shape" | "x" | "y">> = {
  box: preset({ width: 1.2, depth: 1.2 }), wall: preset({ width: 4, depth: 0.3 }),
  cylinder: preset({ width: 1.2, depth: 1.2, radius: 0.6 }), l_shape: preset({}),
  e_shape: preset({ width: 4, depth: 4 }), t_shape: preset({ width: 4, depth: 3.5 }),
  h_shape: preset({ width: 4, depth: 4 }), s_shape: preset({ width: 4, depth: 4 }),
  f_shape: preset({ width: 4, depth: 4 }), frustum: preset({ width: 2.4, depth: 2.4, height: 1.8 }),
  arch: preset({ width: 3.5, depth: 0.8, height: 2.2, thickness: 0.35, clearance: 1.55 }),
  tree: preset({ width: 2.4, depth: 2.4, height: 3.2, radius: 0.28, crownRadius: 1.2 }),
};

const STARTER_OBSTACLES: Obstacle[] = [
  { id: "wall-a", name: "入口墙", shape: "wall", x: -4.6, y: 3.1, ...preset({ width: 4.2, depth: 0.35, thickness: 0.35 }) },
  { id: "corner-a", name: "转角围挡", shape: "l_shape", x: 4.8, y: 2.5, ...preset({ width: 3.4, depth: 3.4, thickness: 0.35, angle: 90 }) },
  { id: "tree-a", name: "树状 01", shape: "tree", x: -2.2, y: -3.4, ...preset({ width: 2.2, depth: 2.2, height: 3, radius: 0.28, crownRadius: 1.1 }) },
  { id: "box-a", name: "箱体 01", shape: "box", x: 3.6, y: -3.8, ...preset({ width: 1.8, depth: 1.25, height: 1.2, angle: -18 }) },
];

const TRACKER_START = { x: -9.5, y: 0, yaw: 0 };
const TARGET_START = { x: -7, y: 0, yaw: 0 };
const DEFAULT_BOUNDARY = { enabled: true, thickness: 0.15, height: 1.5 };

type DragState = {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  mapRect: DOMRect;
  before: Obstacle[];
  moved: boolean;
};

const uid = () => `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const xmlNumber = (value: number) => rounded(value).toString();
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "tracking_map";

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function targetXml(target: MapFile["target"]) {
  return `    <body name="target" pos="${xmlNumber(target.x)} ${xmlNumber(target.y)} 0" euler="0 0 ${xmlNumber(target.yaw * Math.PI / 180)}">
      <geom name="target_left_leg" type="cylinder" pos="0 0.085 0.357" size="0.055 0.357" rgba="0.12 0.22 0.75 1"/>
      <geom name="target_right_leg" type="cylinder" pos="0 -0.085 0.357" size="0.055 0.357" rgba="0.12 0.22 0.75 1"/>
      <geom name="target_torso" type="cylinder" pos="0 0 0.952" size="0.162 0.289" rgba="0.85 0.18 0.08 1"/>
      <geom name="target_left_arm" type="cylinder" pos="0 0.230 0.935" size="0.043 0.319" rgba="0.85 0.18 0.08 1"/>
      <geom name="target_right_arm" type="cylinder" pos="0 -0.230 0.935" size="0.043 0.319" rgba="0.85 0.18 0.08 1"/>
      <geom name="target_head" type="sphere" pos="0 0 1.428" size="0.119" rgba="0.95 0.68 0.45 1"/>
    </body>`;
}

function boundaryXml(file: MapFile) {
  if (!file.boundary.enabled) return "";
  const { thickness, height } = file.boundary;
  const halfThickness = thickness / 2;
  const halfHeight = height / 2;
  const horizontalY = file.map.height / 2 - halfThickness;
  const verticalX = file.map.width / 2 - halfThickness;
  const rgba = "0.17 0.21 0.23 1";
  return `    <!-- neural_tracker closed boundary: tracker.radius = ${xmlNumber(thickness)} m -->
    <body name="map_boundary_top" pos="0 ${xmlNumber(horizontalY)} ${xmlNumber(halfHeight)}">
      <geom name="map_boundary_top_geom" type="box" size="${xmlNumber(file.map.width / 2)} ${xmlNumber(halfThickness)} ${xmlNumber(halfHeight)}" rgba="${rgba}"/>
    </body>
    <body name="map_boundary_bottom" pos="0 ${xmlNumber(-horizontalY)} ${xmlNumber(halfHeight)}">
      <geom name="map_boundary_bottom_geom" type="box" size="${xmlNumber(file.map.width / 2)} ${xmlNumber(halfThickness)} ${xmlNumber(halfHeight)}" rgba="${rgba}"/>
    </body>
    <body name="map_boundary_left" pos="${xmlNumber(-verticalX)} 0 ${xmlNumber(halfHeight)}">
      <geom name="map_boundary_left_geom" type="box" size="${xmlNumber(halfThickness)} ${xmlNumber(file.map.height / 2)} ${xmlNumber(halfHeight)}" rgba="${rgba}"/>
    </body>
    <body name="map_boundary_right" pos="${xmlNumber(verticalX)} 0 ${xmlNumber(halfHeight)}">
      <geom name="map_boundary_right_geom" type="box" size="${xmlNumber(halfThickness)} ${xmlNumber(file.map.height / 2)} ${xmlNumber(halfHeight)}" rgba="${rgba}"/>
    </body>`;
}

function toMujoco(file: MapFile) {
  const meshAssets = file.obstacles.map((obstacle, index) => {
    if (obstacle.shape !== "frustum") return "";
    const w = obstacle.width / 2, d = obstacle.depth / 2, h = obstacle.height / 2;
    const tw = w * obstacle.topScale, td = d * obstacle.topScale;
    const vertices = [[-w,-d,-h],[w,-d,-h],[w,d,-h],[-w,d,-h],[-tw,-td,h],[tw,-td,h],[tw,td,h],[-tw,td,h]]
      .flat().map(xmlNumber).join(" ");
    const faces = "0 2 1 0 3 2 4 5 6 4 6 7 0 1 5 0 5 4 1 2 6 1 6 5 2 3 7 2 7 6 3 0 4 3 4 7";
    return `    <mesh name="frustum_${String(index).padStart(3, "0")}" vertex="${vertices}" face="${faces}"/>`;
  }).filter(Boolean).join("\n");
  const geoms = file.obstacles.map((obstacle, index) => {
    const body = `obstacle_${String(index).padStart(3, "0")}`;
    const z = obstacle.height / 2;
    const angle = obstacle.angle * Math.PI / 180;
    const header = `    <body name="${body}" pos="${xmlNumber(obstacle.x)} ${xmlNumber(obstacle.y)} ${xmlNumber(z)}" euler="0 0 ${xmlNumber(angle)}">`;
    if (obstacle.shape === "cylinder") {
      return `${header}\n      <geom name="${body}_geom" type="cylinder" size="${xmlNumber(obstacle.radius)} ${xmlNumber(z)}" rgba="0.27 0.34 0.32 1"/>\n    </body>`;
    }
    if (isCompositeShape(obstacle.shape)) {
      const parts = localRects(obstacle).map((rect, part) => `      <geom name="${body}_part_${part}" type="box" pos="${xmlNumber(rect.x)} ${xmlNumber(rect.y)} 0" size="${xmlNumber(rect.width / 2)} ${xmlNumber(rect.depth / 2)} ${xmlNumber(z)}" rgba="0.22 0.28 0.31 1"/>`).join("\n");
      return `${header}\n${parts}\n    </body>`;
    }
    if (obstacle.shape === "frustum") {
      return `${header}\n      <geom name="${body}_geom" type="mesh" mesh="frustum_${String(index).padStart(3, "0")}" rgba="0.38 0.44 0.42 1"/>\n    </body>`;
    }
    if (obstacle.shape === "tree") {
      const trunkHeight = Math.max(0.2, obstacle.height * 0.58);
      const crownZ = trunkHeight + (obstacle.height - trunkHeight) / 2;
      return `    <body name="${body}" pos="${xmlNumber(obstacle.x)} ${xmlNumber(obstacle.y)} 0" euler="0 0 ${xmlNumber(angle)}">\n      <geom name="${body}_trunk" type="cylinder" pos="0 0 ${xmlNumber(trunkHeight / 2)}" size="${xmlNumber(obstacle.radius)} ${xmlNumber(trunkHeight / 2)}" rgba="0.38 0.25 0.15 1"/>\n      <geom name="${body}_crown" type="ellipsoid" pos="0 0 ${xmlNumber(crownZ)}" size="${xmlNumber(obstacle.crownRadius)} ${xmlNumber(obstacle.crownRadius)} ${xmlNumber((obstacle.height - trunkHeight) / 2)}" rgba="0.23 0.46 0.29 1"/>\n    </body>`;
    }
    if (obstacle.shape === "arch") {
      const thickness = Math.min(clampedThickness(obstacle), obstacle.width / 3);
      const clearance = Math.max(0.2, Math.min(obstacle.clearance, obstacle.height - thickness));
      const legX = (obstacle.width - thickness) / 2;
      const radiusX = Math.max(thickness, legX);
      const radiusZ = Math.max(thickness, obstacle.height - clearance - thickness / 2);
      const count = 9;
      const archSegments = Array.from({ length: count }, (_, segment) => {
        const theta = Math.PI * segment / (count - 1);
        const x = radiusX * Math.cos(theta);
        const archZ = clearance + radiusZ * Math.sin(theta);
        const dx = -radiusX * Math.sin(theta);
        const dz = radiusZ * Math.cos(theta);
        const tangent = Math.atan2(dz, dx);
        const length = Math.PI * Math.max(radiusX, radiusZ) / (count - 1) * 0.62;
        return `      <geom name="${body}_arch_${segment}" type="box" pos="${xmlNumber(x)} 0 ${xmlNumber(archZ)}" euler="0 ${xmlNumber(-tangent)} 0" size="${xmlNumber(length / 2)} ${xmlNumber(obstacle.depth / 2)} ${xmlNumber(thickness / 2)}" rgba="0.40 0.45 0.43 1"/>`;
      }).join("\n");
      return `    <body name="${body}" pos="${xmlNumber(obstacle.x)} ${xmlNumber(obstacle.y)} 0" euler="0 0 ${xmlNumber(angle)}">\n      <geom name="${body}_left" type="box" pos="${xmlNumber(-legX)} 0 ${xmlNumber(clearance / 2)}" size="${xmlNumber(thickness / 2)} ${xmlNumber(obstacle.depth / 2)} ${xmlNumber(clearance / 2)}" rgba="0.34 0.39 0.38 1"/>\n      <geom name="${body}_right" type="box" pos="${xmlNumber(legX)} 0 ${xmlNumber(clearance / 2)}" size="${xmlNumber(thickness / 2)} ${xmlNumber(obstacle.depth / 2)} ${xmlNumber(clearance / 2)}" rgba="0.34 0.39 0.38 1"/>\n${archSegments}\n    </body>`;
    }
    return `${header}\n      <geom name="${body}_geom" type="box" size="${xmlNumber(obstacle.width / 2)} ${xmlNumber(obstacle.depth / 2)} ${xmlNumber(z)}" rgba="0.25 0.31 0.34 1"/>\n    </body>`;
  }).join("\n");

  return `<!-- Generated by Neural Tracker Map Studio. Units: metres, angles: radians. -->
<mujoco model="${safeName(file.name)}">
  <compiler angle="radian"/>
  <default>
    <geom contype="2" conaffinity="1" friction="0.8 0.01 0.001" solref="0.002 1" solimp="0.95 0.99 0.01 0.5 2"/>
  </default>
  <asset>
${meshAssets}
  </asset>
  <worldbody>
${boundaryXml(file)}
${geoms}
${targetXml(file.target)}
  </worldbody>
</mujoco>
`;
}

function NumberField({ label, value, min, max, step = 0.1, suffix = "m", onChange }: { label: string; value: number; min?: number; max?: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="number-field"><span>{label}</span><div><input aria-label={label} type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /><em>{suffix}</em></div></label>;
}

export default function Home() {
  const [mapName, setMapName] = useState("g1_custom_test");
  const [mapWidth, setMapWidth] = useState(80);
  const [mapHeight, setMapHeight] = useState(80);
  const [resolution, setResolution] = useState(0.05);
  const [boundary, setBoundary] = useState(DEFAULT_BOUNDARY);
  const [shape, setShape] = useState<Shape>("wall");
  const [draft, setDraft] = useState(PRESETS.wall);
  const [obstacles, setObstacles] = useState<Obstacle[]>(STARTER_OBSTACLES);
  const [selectedId, setSelectedId] = useState<string | null>(STARTER_OBSTACLES[1].id);
  const [snap, setSnap] = useState(true);
  const [placing, setPlacing] = useState(true);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [tracker, setTracker] = useState(TRACKER_START);
  const [target, setTarget] = useState(TARGET_START);
  const [toast, setToast] = useState("");
  const [undoStack, setUndoStack] = useState<Obstacle[][]>([]);
  const [redoStack, setRedoStack] = useState<Obstacle[][]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const previewDragBeforeRef = useRef<Obstacle[] | null>(null);

  const selected = obstacles.find((item) => item.id === selectedId) ?? null;
  const mapFile = useMemo<MapFile>(() => ({ format: "neural-tracker-map", version: 1, name: mapName, map: { width: mapWidth, height: mapHeight, resolution }, boundary, tracker, target, obstacles }), [mapName, mapWidth, mapHeight, resolution, boundary, tracker, target, obstacles]);

  const announce = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const commit = useCallback((next: Obstacle[]) => {
    setUndoStack((stack) => [...stack.slice(-29), obstacles]);
    setRedoStack([]);
    setObstacles(next);
  }, [obstacles]);

  const closeGenerator = useCallback(() => setGeneratorOpen(false), []);

  const generateMap = (config: GeneratorConfig, spacing: number) => {
    const result = generateNonOverlappingMap({
      config,
      mapWidth,
      mapHeight,
      boundaryThickness: boundary.enabled ? boundary.thickness : 0,
      tracker,
      target,
      spacing,
      snapGrid: snap ? Math.max(resolution, 0.25) : null,
    });
    if (!result.ok) return result.error;
    commit(result.obstacles);
    setSelectedId(null);
    setPlacing(false);
    announce(`已生成 ${result.obstacles.length} 个无重叠障碍物`);
    return null;
  };

  const updateObstacle = (id: string, patch: Partial<Obstacle>) => {
    commit(obstacles.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const selectShape = (next: Shape) => {
    setShape(next);
    setDraft(PRESETS[next]);
    setPlacing(true);
    setSelectedId(null);
  };

  const mapPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!placing || (event.target as HTMLElement).closest("[data-obstacle]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    let x = ((event.clientX - rect.left) / rect.width - 0.5) * mapWidth;
    let y = (0.5 - (event.clientY - rect.top) / rect.height) * mapHeight;
    if (snap) {
      const grid = Math.max(resolution, 0.25);
      x = Math.round(x / grid) * grid;
      y = Math.round(y / grid) * grid;
    }
    const count = obstacles.filter((item) => item.shape === shape).length + 1;
    const item: Obstacle = { id: uid(), name: `${SHAPES.find((item) => item.id === shape)?.title} ${String(count).padStart(2, "0")}`, shape, x: rounded(x), y: rounded(y), ...draft };
    commit([...obstacles, item]);
    setSelectedId(item.id);
    setPlacing(false);
    announce(`已放置：${item.name}`);
  };

  const obstaclePointerDown = (event: PointerEvent<HTMLButtonElement>, item: Obstacle) => {
    event.stopPropagation();
    const mapRect = mapRef.current?.getBoundingClientRect();
    if (!mapRect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(item.id);
    setPlacing(false);
    dragRef.current = {
      id: item.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: item.x,
      originY: item.y,
      mapRect,
      before: obstacles,
      moved: false,
    };
  };

  const obstaclePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = (event.clientX - drag.startClientX) / drag.mapRect.width * mapWidth;
    const deltaY = -(event.clientY - drag.startClientY) / drag.mapRect.height * mapHeight;
    if (!drag.moved && Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 2) return;
    drag.moved = true;
    const grid = Math.max(resolution, 0.25);
    const clampX = (value: number) => Math.max(-mapWidth / 2, Math.min(mapWidth / 2, value));
    const clampY = (value: number) => Math.max(-mapHeight / 2, Math.min(mapHeight / 2, value));
    let x = clampX(drag.originX + deltaX);
    let y = clampY(drag.originY + deltaY);
    if (snap) {
      x = Math.round(x / grid) * grid;
      y = Math.round(y / grid) * grid;
    }
    setObstacles((current) => current.map((obstacle) => obstacle.id === drag.id ? { ...obstacle, x: rounded(x), y: rounded(y) } : obstacle));
  };

  const obstaclePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      setUndoStack((stack) => [...stack.slice(-29), drag.before]);
      setRedoStack([]);
      announce("障碍物位置已更新");
    }
    dragRef.current = null;
  };

  const previewDragStart = () => {
    previewDragBeforeRef.current = obstacles;
  };

  const previewDrag = (id: string, x: number, y: number) => {
    setObstacles((current) => current.map((obstacle) => obstacle.id === id ? { ...obstacle, x, y } : obstacle));
  };

  const previewDragEnd = (_id: string, moved: boolean) => {
    const before = previewDragBeforeRef.current;
    if (moved && before) {
      setUndoStack((stack) => [...stack.slice(-29), before]);
      setRedoStack([]);
      announce("3D 视图中的障碍物位置已更新");
    }
    previewDragBeforeRef.current = null;
  };

  const undo = useCallback(() => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((stack) => [...stack, obstacles]);
    setObstacles(previous);
    setUndoStack((stack) => stack.slice(0, -1));
    setSelectedId(null);
  }, [undoStack, obstacles]);

  const redo = useCallback(() => {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((stack) => [...stack, obstacles]);
    setObstacles(next);
    setRedoStack((stack) => stack.slice(0, -1));
    setSelectedId(null);
  }, [redoStack, obstacles]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit(obstacles.filter((item) => item.id !== selectedId));
    setSelectedId(null);
    announce("障碍物已删除");
  }, [selectedId, obstacles, commit, announce]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input, textarea")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (event.key === "Delete" || event.key === "Backspace") removeSelected();
      if (event.key === "Escape") { setPlacing(false); setSelectedId(null); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, removeSelected]);

  const exportJson = () => {
    download(`${safeName(mapName)}.json`, JSON.stringify(mapFile, null, 2), "application/json");
    announce("地图 JSON 已导出");
  };

  const exportXml = () => {
    download(`${safeName(mapName)}.xml`, toMujoco(mapFile), "application/xml");
    announce("MuJoCo XML 已导出");
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as MapFile;
      if (parsed.format !== "neural-tracker-map" || !Array.isArray(parsed.obstacles)) throw new Error("format");
      setMapName(parsed.name || "imported_map");
      setMapWidth(parsed.map.width);
      setMapHeight(parsed.map.height);
      setResolution(parsed.map.resolution);
      setBoundary(parsed.boundary ?? DEFAULT_BOUNDARY);
      setTracker(parsed.tracker ?? TRACKER_START);
      setTarget(parsed.target ?? TARGET_START);
      setObstacles(parsed.obstacles.map((item) => ({ ...preset({}), ...item })));
      setSelectedId(null);
      setUndoStack([]);
      setRedoStack([]);
      announce(`已导入 ${parsed.obstacles.length} 个障碍物`);
    } catch {
      announce("导入失败：不是有效的 Neural Tracker 地图");
    } finally {
      event.target.value = "";
    }
  };

  const footprint = (item: Obstacle) => item.shape === "cylinder" ? { width: item.radius * 2, depth: item.radius * 2 } : item.shape === "tree" ? { width: item.crownRadius * 2, depth: item.crownRadius * 2 } : { width: item.width, depth: item.depth };

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">N</span><div><b>Neural Tracker</b><small>MAP STUDIO</small></div></div>
      <div className="map-title"><span className="status-dot" /> <input aria-label="地图名称" value={mapName} onChange={(event) => setMapName(event.target.value)} /><span className="saved">本地编辑</span></div>
      <div className="header-actions">
        <button className="generate-button" onClick={() => setGeneratorOpen(true)}>⚡ 一键生成</button>
        <button className="ghost-button" onClick={() => fileInput.current?.click()}>↥ 导入 JSON</button>
        <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={importJson} />
        <button className="ghost-button" onClick={exportJson}>↓ 保存工程</button>
        <button className="primary-button" onClick={exportXml}>导出 MuJoCo XML <span>↗</span></button>
      </div>
    </header>

    <section className="workspace">
      <aside className="left-panel panel">
        <div className="panel-heading"><div><small>01 / LIBRARY</small><h2>障碍物形状</h2></div><span className="step-pill">12</span></div>
        <div className="shape-grid">
          {SHAPES.map((item) => <button key={item.id} className={`shape-card ${shape === item.id ? "active" : ""}`} onClick={() => selectShape(item.id)}><span>{item.glyph}</span><b>{item.title}</b><small>{item.hint}</small></button>)}
        </div>

        <div className="section-divider" />
        <div className="subheading"><div><small>02 / DIMENSIONS</small><h3>设置尺寸</h3></div><span>单位：米</span></div>
        <div className="field-grid">
          {(shape === "cylinder" || shape === "tree") ? <>
            <NumberField label={shape === "tree" ? "树干半径" : "半径"} value={draft.radius} min={0.05} onChange={(value) => setDraft({ ...draft, radius: value })} />
            {shape === "tree" && <NumberField label="树冠半径" value={draft.crownRadius} min={draft.radius} onChange={(value) => setDraft({ ...draft, crownRadius: Math.max(value, draft.radius) })} />}
          </> : <>
            <NumberField label={shape === "wall" ? "长度" : "宽度"} value={draft.width} min={0.05} onChange={(value) => setDraft({ ...draft, width: value, ...(isCompositeShape(shape) ? { thickness: Math.max(0.05, Math.min(draft.thickness, value, draft.depth)) } : {}) })} />
            <NumberField label={shape === "wall" ? "厚度" : "深度"} value={draft.depth} min={0.05} onChange={(value) => setDraft({ ...draft, depth: value, ...(shape === "wall" ? { thickness: value } : {}), ...(isCompositeShape(shape) ? { thickness: Math.max(0.05, Math.min(draft.thickness, draft.width, value)) } : {}) })} />
            {(isCompositeShape(shape) || shape === "arch") && <NumberField label="壁厚" value={draft.thickness} min={0.05} max={Math.min(draft.width, draft.depth)} onChange={(value) => setDraft({ ...draft, thickness: Math.max(0.05, Math.min(value, draft.width, draft.depth)) })} />}
            {shape === "frustum" && <NumberField label="顶面比例" value={draft.topScale * 100} min={10} max={95} step={5} suffix="%" onChange={(value) => setDraft({ ...draft, topScale: Math.max(.1, Math.min(.95, value / 100)) })} />}
            {shape === "arch" && <NumberField label="净空高度" value={draft.clearance} min={0.2} max={draft.height - 0.05} onChange={(value) => setDraft({ ...draft, clearance: Math.max(.2, Math.min(value, draft.height - .05)) })} />}
          </>}
          <NumberField label="高度" value={draft.height} min={0.05} onChange={(value) => setDraft({ ...draft, height: value })} />
        </div>
        <label className="angle-control"><span><b>放置角度</b><em>{draft.angle}°</em></span><input aria-label="放置角度" type="range" min="-180" max="180" step="1" value={draft.angle} onChange={(event) => setDraft({ ...draft, angle: Number(event.target.value) })} /></label>
        <button className={`place-button ${placing ? "armed" : ""}`} onClick={() => { setPlacing(true); setSelectedId(null); }}>{placing ? "在画布中点击放置…" : "+ 放置一个障碍物"}</button>
        <p className="microcopy">放置后可直接拖动障碍物，也可在属性面板精确修改坐标与角度。</p>
      </aside>

      <section className="canvas-column">
        <div className="canvas-toolbar">
          <div className="toolbar-group"><button onClick={undo} disabled={!undoStack.length} title="撤销">↶</button><button onClick={redo} disabled={!redoStack.length} title="重做">↷</button><i /><button className={placing ? "active" : ""} onClick={() => setPlacing(!placing)}>⌖ 放置</button><button className={!placing ? "active" : ""} onClick={() => setPlacing(false)}>↖ 选择</button></div>
          <div className="view-switch"><button className={viewMode === "2d" ? "active" : ""} onClick={() => setViewMode("2d")}>2D 编辑</button><button className={viewMode === "3d" ? "active" : ""} onClick={() => { setViewMode("3d"); setPlacing(false); }}>3D 预览</button></div>
          <label className="snap-control"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> 网格吸附 <kbd>{Math.max(resolution, 0.25)} m</kbd></label>
        </div>
        {viewMode === "3d" ? <ThreePreview width={mapWidth} height={mapHeight} boundary={boundary} obstacles={obstacles} selectedId={selectedId} snapGrid={snap ? Math.max(resolution, .25) : null} tracker={tracker} target={target} onSelect={setSelectedId} onDragStart={previewDragStart} onDrag={previewDrag} onDragEnd={previewDragEnd} /> : <div ref={mapRef} className={`map-wrap ${placing ? "placing" : ""}`} style={{ aspectRatio: `${mapWidth} / ${mapHeight}` }} onPointerDown={mapPointerDown}>
          {boundary.enabled && <div className="boundary-walls" aria-label={`neural_tracker 外墙，厚 ${boundary.thickness} 米`}>
            <i className="boundary-wall boundary-top" style={{ height: `${boundary.thickness / mapHeight * 100}%` }} />
            <i className="boundary-wall boundary-bottom" style={{ height: `${boundary.thickness / mapHeight * 100}%` }} />
            <i className="boundary-wall boundary-left" style={{ width: `${boundary.thickness / mapWidth * 100}%` }} />
            <i className="boundary-wall boundary-right" style={{ width: `${boundary.thickness / mapWidth * 100}%` }} />
          </div>}
          <div className="axis axis-y"><span>+Y</span><i /></div><div className="axis axis-x"><span>+X</span><i /></div>
          <div className="origin-label">0, 0</div>
          {obstacles.map((item) => {
            const size = footprint(item);
            const parts = isCompositeShape(item.shape) ? localRects(item) : [];
            return <button
              type="button"
              data-obstacle
              aria-label={`${item.name}，点击选择或拖动`}
              key={item.id}
              className={`obstacle ${item.shape} ${selectedId === item.id ? "selected" : ""}`}
              style={{ left: `${(item.x / mapWidth + 0.5) * 100}%`, top: `${(0.5 - item.y / mapHeight) * 100}%`, width: `${size.width / mapWidth * 100}%`, height: `${size.depth / mapHeight * 100}%`, transform: `translate(-50%, -50%) rotate(${-item.angle}deg)` }}
              onPointerDown={(event) => obstaclePointerDown(event, item)}
              onPointerMove={obstaclePointerMove}
              onPointerUp={obstaclePointerUp}
              onPointerCancel={obstaclePointerUp}
            ><span className="obstacle-label" style={{ transform: `rotate(${item.angle}deg)` }}>{selectedId === item.id ? item.name : ""}</span>
              {parts.map((part, index) => <i key={index} className="shape-part" style={{ left: `${(part.x / item.width + .5) * 100}%`, top: `${(.5 - part.y / item.depth) * 100}%`, width: `${part.width / item.width * 100}%`, height: `${part.depth / item.depth * 100}%` }} />)}
              {item.shape === "frustum" && <i className="frustum-top" style={{ inset: `${(1 - item.topScale) * 50}%` }} />}
              {item.shape === "arch" && <><i className="arch-leg arch-left" style={{ width: `${clampedThickness(item) / item.width * 100}%` }} /><i className="arch-leg arch-right" style={{ width: `${clampedThickness(item) / item.width * 100}%` }} /><i className="arch-span" /></>}
              {item.shape === "tree" && <><i className="tree-crown" /><i className="tree-trunk" style={{ width: `${item.radius / item.crownRadius * 100}%`, height: `${item.radius / item.crownRadius * 100}%` }} /></>}
            </button>;
          })}
          <div className="target-marker" style={{ left: `${(target.x / mapWidth + 0.5) * 100}%`, top: `${(0.5 - target.y / mapHeight) * 100}%`, transform: `translate(-50%, -50%) rotate(${-target.yaw}deg)` }}><i /><span>目标</span></div>
          <div className="tracker-marker" style={{ left: `${(tracker.x / mapWidth + 0.5) * 100}%`, top: `${(0.5 - tracker.y / mapHeight) * 100}%`, transform: `translate(-50%, -50%) rotate(${-tracker.yaw}deg)` }}><i>NT</i><span>tracker</span></div>
          <span className="scale-label scale-left">−{mapWidth / 2}m</span><span className="scale-label scale-right">+{mapWidth / 2}m</span>
        </div>}
        <div className="canvas-footer"><span><i className="legend boundary-dot" /> 外墙</span><span><i className="legend obstacle-dot" /> 障碍物</span><span><i className="legend target-dot" /> 目标</span><span><i className="legend tracker-dot" /> tracker</span><strong>{obstacles.length} 个内部障碍物 · {mapWidth * mapHeight} m²</strong></div>
      </section>

      <aside className="right-panel panel">
        <div className="panel-heading"><div><small>03 / PROPERTIES</small><h2>属性检查器</h2></div><span className="step-pill muted">3</span></div>
        {selected ? <div className="inspector">
          <label className="name-field"><span>名称</span><input value={selected.name} onChange={(event) => updateObstacle(selected.id, { name: event.target.value })} /></label>
          <div className="type-chip"><span>{SHAPES.find((item) => item.id === selected.shape)?.glyph}</span><div><small>类型</small><b>{SHAPES.find((item) => item.id === selected.shape)?.title}</b></div></div>
          <div className="subheading compact"><div><small>TRANSFORM</small><h3>位置与旋转</h3></div></div>
          <div className="field-grid"><NumberField label="X 坐标" value={selected.x} step={0.05} onChange={(value) => updateObstacle(selected.id, { x: value })} /><NumberField label="Y 坐标" value={selected.y} step={0.05} onChange={(value) => updateObstacle(selected.id, { y: value })} /></div>
          <NumberField label="旋转角度" value={selected.angle} min={-180} max={180} step={1} suffix="°" onChange={(value) => updateObstacle(selected.id, { angle: value })} />
          <label className="angle-control inspector-angle"><input aria-label="旋转角度滑杆" type="range" min="-180" max="180" value={selected.angle} onChange={(event) => updateObstacle(selected.id, { angle: Number(event.target.value) })} /><span className="ticks"><i>−180°</i><i>0°</i><i>180°</i></span></label>
          <div className="subheading compact"><div><small>GEOMETRY</small><h3>几何尺寸</h3></div></div>
          <div className="field-grid">
            {(selected.shape === "cylinder" || selected.shape === "tree") ? <>
              <NumberField label={selected.shape === "tree" ? "树干半径" : "半径"} value={selected.radius} min={0.05} onChange={(value) => updateObstacle(selected.id, { radius: value })} />
              {selected.shape === "tree" && <NumberField label="树冠半径" value={selected.crownRadius} min={selected.radius} onChange={(value) => updateObstacle(selected.id, { crownRadius: Math.max(value, selected.radius) })} />}
            </> : <><NumberField label="宽度" value={selected.width} min={0.05} onChange={(value) => updateObstacle(selected.id, { width: value, ...(isCompositeShape(selected.shape) ? { thickness: Math.max(0.05, Math.min(selected.thickness, value, selected.depth)) } : {}) })} /><NumberField label="深度" value={selected.depth} min={0.05} onChange={(value) => updateObstacle(selected.id, { depth: value, ...(isCompositeShape(selected.shape) ? { thickness: Math.max(0.05, Math.min(selected.thickness, selected.width, value)) } : {}) })} /></>}
            <NumberField label="高度" value={selected.height} min={0.05} onChange={(value) => updateObstacle(selected.id, { height: value })} />
            {(isCompositeShape(selected.shape) || selected.shape === "arch") && <NumberField label="壁厚" value={selected.thickness} min={0.05} max={Math.min(selected.width, selected.depth)} onChange={(value) => updateObstacle(selected.id, { thickness: Math.max(0.05, Math.min(value, selected.width, selected.depth)) })} />}
            {selected.shape === "frustum" && <NumberField label="顶面比例" value={selected.topScale * 100} min={10} max={95} step={5} suffix="%" onChange={(value) => updateObstacle(selected.id, { topScale: Math.max(.1, Math.min(.95, value / 100)) })} />}
            {selected.shape === "arch" && <NumberField label="净空高度" value={selected.clearance} min={0.2} max={selected.height - .05} onChange={(value) => updateObstacle(selected.id, { clearance: Math.max(.2, Math.min(value, selected.height - .05)) })} />}
          </div>
          <div className="inspector-actions"><button onClick={() => { const copy = { ...selected, id: uid(), name: `${selected.name} 副本`, x: rounded(selected.x + 0.5), y: rounded(selected.y - 0.5) }; commit([...obstacles, copy]); setSelectedId(copy.id); }}>⧉ 复制</button><button className="danger" onClick={removeSelected}>⌫ 删除</button></div>
        </div> : <div className="empty-inspector"><span>↖</span><b>未选择障碍物</b><p>点击画布中的障碍物，在此精确调整位置、角度与尺寸。</p></div>}

        <div className="map-settings">
          <div className="subheading compact"><div><small>MAP SETTINGS</small><h3>地图参数</h3></div></div>
          <div className="field-grid"><NumberField label="宽度" value={mapWidth} min={5} max={100} step={1} onChange={setMapWidth} /><NumberField label="高度" value={mapHeight} min={5} max={100} step={1} onChange={setMapHeight} /><NumberField label="分辨率" value={resolution} min={0.01} max={1} step={0.01} onChange={setResolution} /></div>
          <div className="boundary-setting"><span className="pose-dot boundary-dot" /><p><small>NEURAL_TRACKER 外墙</small><b>四边封闭 · 厚 0.15 m · 高 1.50 m</b></p><em>锁定</em></div>
          <div className="start-poses">
            <div><span className="pose-dot tracker-dot" /><p><small>TRACKER 起点</small><b>−9.5, 0.0, 0°</b></p></div>
            <div><span className="pose-dot target-dot" /><p><small>TARGET 起点</small><b>−7.0, 0.0, 0°</b></p></div>
          </div>
        </div>
      </aside>
    </section>
    <MapGenerator open={generatorOpen} shapes={SHAPES} onClose={closeGenerator} onGenerate={generateMap} />
    <div className={`toast ${toast ? "show" : ""}`} role="status">✓ {toast}</div>
  </main>;
}
