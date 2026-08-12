"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";
import { Obstacle, isCompositeShape, localRects } from "./map-types";

type Props = {
  width: number;
  height: number;
  boundary: { enabled: boolean; thickness: number; height: number };
  obstacles: Obstacle[];
  selectedId: string | null;
  snapGrid: number | null;
  tracker: { x: number; y: number; yaw: number };
  target: { x: number; y: number; yaw: number };
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, moved: boolean) => void;
};

type Point3 = { x: number; y: number; z: number };
type Face = { points: Point3[]; color: string; depth: number };
type HitArea = { id: string; x: number; y: number; radius: number };
type DragState =
  | { mode: "rotate"; pointerId: number; startX: number; startYaw: number }
  | { mode: "obstacle"; pointerId: number; id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean };

const palette = {
  top: "#74877b", side: "#43534b", dark: "#2f3c36", selected: "#2563eb",
  ground: "#eef1eb", grid: "#ced7cf", boundary: "#303a36", trunk: "#73553c", crown: "#4f795a",
};

function rotate(x: number, y: number, angle: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: c * x - s * y, y: s * x + c * y };
}

export default function ThreePreview(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const hitAreasRef = useRef<HitArea[]>([]);
  const transformRef = useRef({ scale: 1, pitch: .58, yaw: 0 });
  const [yaw, setYaw] = useState(-42);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const cw = rect.width, ch = rect.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#f7f8f5";
    ctx.fillRect(0, 0, cw, ch);

    const yawRad = yaw * Math.PI / 180;
    const pitch = 0.58;
    const baseScale = Math.min(cw / (props.width * 1.35), ch / (props.height * 0.78)) * zoom;
    transformRef.current = { scale: baseScale, pitch, yaw: yawRad };
    const project = (point: Point3) => {
      const p = rotate(point.x, point.y, yawRad);
      return { x: cw / 2 + p.x * baseScale, y: ch * 0.58 + (p.y * pitch - point.z) * baseScale };
    };
    const polygon = (points: Point3[], fill: string, stroke = "#24312b") => {
      const projected = points.map(project);
      ctx.beginPath();
      projected.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.65;
      ctx.stroke();
    };
    const faces: Face[] = [];
    const addBox = (cx: number, cy: number, w: number, d: number, h: number, angle: number, selected = false, z0 = 0) => {
      const corners = [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x,y]) => {
        const p = rotate(x, y, angle);
        return { x: cx + p.x, y: cy + p.y };
      });
      const bottom = corners.map(p => ({ ...p, z: z0 }));
      const top = corners.map(p => ({ ...p, z: z0 + h }));
      const color = selected ? palette.selected : palette.top;
      faces.push({ points: top, color, depth: corners.reduce((sum,p)=>sum+p.y,0)/4 + h * .01 });
      for (let i=0;i<4;i++) {
        const j=(i+1)%4;
        faces.push({ points:[bottom[i],bottom[j],top[j],top[i]], color: selected ? "#1f4fb9" : (i%2 ? palette.side : palette.dark), depth:(corners[i].y+corners[j].y)/2 });
      }
    };
    const addCylinder = (cx: number, cy: number, radius: number, h: number, selected: boolean, color = palette.top, z0 = 0) => {
      const count = 18;
      const ring = Array.from({length:count},(_,i)=>({x:cx+Math.cos(i/count*Math.PI*2)*radius,y:cy+Math.sin(i/count*Math.PI*2)*radius}));
      const bottom=ring.map(p=>({...p,z:z0})), top=ring.map(p=>({...p,z:z0+h}));
      faces.push({points:top,color:selected?palette.selected:color,depth:cy+h*.01});
      for(let i=0;i<count;i++){const j=(i+1)%count;faces.push({points:[bottom[i],bottom[j],top[j],top[i]],color:selected?"#1f4fb9":palette.side,depth:(ring[i].y+ring[j].y)/2});}
    };

    polygon([
      {x:-props.width/2,y:-props.height/2,z:0},{x:props.width/2,y:-props.height/2,z:0},
      {x:props.width/2,y:props.height/2,z:0},{x:-props.width/2,y:props.height/2,z:0},
    ], palette.ground, "#9caaa0");
    ctx.strokeStyle = palette.grid; ctx.lineWidth = .45;
    const gridStep = props.width >= 60 ? 10 : 5;
    for(let x=-props.width/2;x<=props.width/2;x+=gridStep){const a=project({x,y:-props.height/2,z:.01}),b=project({x,y:props.height/2,z:.01});ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    for(let y=-props.height/2;y<=props.height/2;y+=gridStep){const a=project({x:-props.width/2,y,z:.01}),b=project({x:props.width/2,y,z:.01});ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}

    if(props.boundary.enabled){const t=props.boundary.thickness,h=props.boundary.height;addBox(0,props.height/2-t/2,props.width,t,h,0,false);addBox(0,-props.height/2+t/2,props.width,t,h,0,false);addBox(-props.width/2+t/2,0,t,props.height,h,0,false);addBox(props.width/2-t/2,0,t,props.height,h,0,false);}

    props.obstacles.forEach(item=>{
      const selected=item.id===props.selectedId, angle=item.angle*Math.PI/180;
      if(isCompositeShape(item.shape)) {
        localRects(item).forEach(r=>{const p=rotate(r.x,r.y,angle);addBox(item.x+p.x,item.y+p.y,r.width,r.depth,item.height,angle,selected);});
      } else if(item.shape==="cylinder") addCylinder(item.x,item.y,item.radius,item.height,selected);
      else if(item.shape==="tree") {
        const trunkH=Math.max(.2,item.height*.58); addCylinder(item.x,item.y,item.radius,trunkH,selected,palette.trunk);
        addCylinder(item.x,item.y,item.crownRadius,item.height-trunkH,selected,palette.crown,trunkH);
      } else if(item.shape==="frustum") {
        const bottom=[[ -item.width/2,-item.depth/2],[item.width/2,-item.depth/2],[item.width/2,item.depth/2],[-item.width/2,item.depth/2]];
        const top=bottom.map(([x,y])=>[x*item.topScale,y*item.topScale]);
        const b=bottom.map(([x,y])=>{const p=rotate(x,y,angle);return{x:item.x+p.x,y:item.y+p.y,z:0}});
        const t=top.map(([x,y])=>{const p=rotate(x,y,angle);return{x:item.x+p.x,y:item.y+p.y,z:item.height}});
        faces.push({points:t,color:selected?palette.selected:palette.top,depth:item.y+item.height*.01});
        for(let i=0;i<4;i++){const j=(i+1)%4;faces.push({points:[b[i],b[j],t[j],t[i]],color:selected?"#1f4fb9":palette.side,depth:(b[i].y+b[j].y)/2});}
      } else if(item.shape==="arch") {
        const t=Math.min(item.thickness,item.width/3), legH=Math.min(item.clearance,item.height-item.thickness);
        [-1,1].forEach(sign=>{const p=rotate(sign*(item.width-t)/2,0,angle);addBox(item.x+p.x,item.y+p.y,t,item.depth,legH,angle,selected);});
        const rx=(item.width-t)/2, rz=Math.max(t,item.height-legH-t/2);
        Array.from({length:9},(_,i)=>Math.PI*i/8).forEach(theta=>{const local=rotate(rx*Math.cos(theta),0,angle);addBox(item.x+local.x,item.y+local.y,Math.max(t,item.width/9),item.depth,t,angle,selected,legH+rz*Math.sin(theta)-t/2);});
      } else addBox(item.x,item.y,item.width,item.depth,item.height,angle,selected);
    });
    faces.sort((a,b)=>a.depth-b.depth).forEach(face=>polygon(face.points,face.color));

    hitAreasRef.current = props.obstacles.map(item => {
      const center = project({ x: item.x, y: item.y, z: Math.min(item.height * .55, 1.2) });
      const footprintRadius = item.shape === "cylinder" ? item.radius
        : item.shape === "tree" ? item.crownRadius
        : Math.hypot(item.width, item.depth) / 2;
      return { id: item.id, x: center.x, y: center.y, radius: Math.max(13, Math.min(46, footprintRadius * baseScale + item.height * baseScale * .35)) };
    });

    const mark=(x:number,y:number,color:string,label:string)=>{const p=project({x,y,z:.08});ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.fillStyle="#25312b";ctx.font="700 9px Arial";ctx.fillText(label,p.x+7,p.y+3);};
    mark(props.tracker.x,props.tracker.y,"#1777d2","tracker"); mark(props.target.x,props.target.y,"#ff8e44","target");
  }, [props, yaw, zoom]);

  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const hits = hitAreasRef.current
      .map(area => ({ area, distance: Math.hypot(x - area.x, y - area.y) }))
      .filter(hit => hit.distance <= hit.area.radius)
      .sort((a, b) => {
        if (a.area.id === props.selectedId) return -1;
        if (b.area.id === props.selectedId) return 1;
        return a.distance - b.distance;
      });
    event.currentTarget.setPointerCapture(event.pointerId);
    const hit = hits[0]?.area;
    if (hit) {
      const obstacle = props.obstacles.find(item => item.id === hit.id);
      if (!obstacle) return;
      props.onSelect(hit.id);
      props.onDragStart(hit.id);
      dragRef.current = { mode: "obstacle", pointerId: event.pointerId, id: hit.id, startX: event.clientX, startY: event.clientY, originX: obstacle.x, originY: obstacle.y, moved: false };
      return;
    }
    dragRef.current = { mode: "rotate", pointerId: event.pointerId, startX: event.clientX, startYaw: yaw };
  };

  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === "rotate") {
      setYaw(drag.startYaw + (event.clientX - drag.startX) * .45);
      return;
    }
    const screenDistance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && screenDistance < 2) return;
    drag.moved = true;
    const transform = transformRef.current;
    const rotatedDeltaX = (event.clientX - drag.startX) / transform.scale;
    const rotatedDeltaY = (event.clientY - drag.startY) / (transform.scale * transform.pitch);
    const worldDelta = rotate(rotatedDeltaX, rotatedDeltaY, -transform.yaw);
    let x = Math.max(-props.width / 2, Math.min(props.width / 2, drag.originX + worldDelta.x));
    let y = Math.max(-props.height / 2, Math.min(props.height / 2, drag.originY + worldDelta.y));
    if (props.snapGrid) {
      x = Math.round(x / props.snapGrid) * props.snapGrid;
      y = Math.round(y / props.snapGrid) * props.snapGrid;
    }
    props.onDrag(drag.id, Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
  };

  const pointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.mode === "obstacle") props.onDragEnd(drag.id, drag.moved);
    dragRef.current = null;
  };

  return <div className="preview3d-wrap">
    <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label="地图三维编辑预览，拖动障碍物移动，拖动空白区域旋转视角" />
    <div className="preview3d-controls"><span>拖动模型移动 · 拖动空白旋转</span><button onClick={()=>setYaw(-42)}>重置视角</button><label>缩放 <input aria-label="3D 预览缩放" type="range" min="0.65" max="2.2" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label></div>
  </div>;
}
