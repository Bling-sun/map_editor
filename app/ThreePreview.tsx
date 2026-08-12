"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";
import { Obstacle, isCompositeShape, localRects } from "./map-types";

type Props = {
  width: number;
  height: number;
  boundary: { enabled: boolean; thickness: number; height: number };
  obstacles: Obstacle[];
  selectedId: string | null;
  tracker: { x: number; y: number; yaw: number };
  target: { x: number; y: number; yaw: number };
};

type Point3 = { x: number; y: number; z: number };
type Face = { points: Point3[]; color: string; depth: number };

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
  const dragRef = useRef<{ id: number; x: number; yaw: number } | null>(null);
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

    const mark=(x:number,y:number,color:string,label:string)=>{const p=project({x,y,z:.08});ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.fillStyle="#25312b";ctx.font="700 9px Arial";ctx.fillText(label,p.x+7,p.y+3);};
    mark(props.tracker.x,props.tracker.y,"#1777d2","tracker"); mark(props.target.x,props.target.y,"#ff8e44","target");
  }, [props, yaw, zoom]);

  const pointerDown=(event:PointerEvent<HTMLCanvasElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);dragRef.current={id:event.pointerId,x:event.clientX,yaw};};
  const pointerMove=(event:PointerEvent<HTMLCanvasElement>)=>{const d=dragRef.current;if(d?.id===event.pointerId)setYaw(d.yaw+(event.clientX-d.x)*.45);};
  const pointerUp=(event:PointerEvent<HTMLCanvasElement>)=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);dragRef.current=null;};

  return <div className="preview3d-wrap">
    <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label="地图三维预览，左右拖动旋转视角" />
    <div className="preview3d-controls"><span>拖动画布旋转</span><button onClick={()=>setYaw(-42)}>重置视角</button><label>缩放 <input aria-label="3D 预览缩放" type="range" min="0.65" max="2.2" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label></div>
  </div>;
}
