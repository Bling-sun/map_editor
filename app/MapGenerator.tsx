"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_GENERATOR_CONFIG, GeneratorConfig } from "./map-generator";
import type { Shape } from "./map-types";

type ShapeOption = { id: Shape; title: string; hint: string; glyph: string };

type Props = {
  open: boolean;
  shapes: ShapeOption[];
  onClose: () => void;
  onGenerate: (config: GeneratorConfig, spacing: number) => string | null;
};

function cloneDefaults(): GeneratorConfig {
  return Object.fromEntries(Object.entries(DEFAULT_GENERATOR_CONFIG).map(([key, value]) => [key, { ...value }])) as GeneratorConfig;
}

export default function MapGenerator({ open, shapes, onClose, onGenerate }: Props) {
  const [config, setConfig] = useState<GeneratorConfig>(cloneDefaults);
  const [spacing, setSpacing] = useState(0.35);
  const [error, setError] = useState("");
  const total = useMemo(() => shapes.reduce((sum, shape) => sum + (config[shape.id].enabled ? Math.max(0, config[shape.id].count || 0) : 0), 0), [config, shapes]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const update = (shape: Shape, patch: Partial<GeneratorConfig[Shape]>) => {
    setConfig((current) => ({ ...current, [shape]: { ...current[shape], ...patch } }));
    setError("");
  };

  const setAll = (enabled: boolean) => {
    setConfig((current) => Object.fromEntries(shapes.map((shape) => [shape.id, { ...current[shape.id], enabled }])) as GeneratorConfig);
    setError("");
  };

  const submit = () => {
    const nextError = onGenerate(config, spacing);
    if (nextError) setError(nextError);
    else onClose();
  };

  return <div className="generator-backdrop">
    <section className="generator-dialog" role="dialog" aria-modal="true" aria-labelledby="generator-title">
      <header className="generator-header">
        <div><small>RANDOM MAP BUILDER</small><h2 id="generator-title">一键生成无重叠地图</h2><p>选择多个元素类型，并分别设置数量、平面尺寸与高度范围。</p></div>
        <button className="generator-close" aria-label="关闭一键生成面板" onClick={onClose}>×</button>
      </header>

      <div className="generator-tools">
        <div><button onClick={() => setAll(true)}>全选</button><button onClick={() => setAll(false)}>清空</button></div>
        <label><span>元素安全间距</span><input aria-label="元素安全间距" type="number" min="0" max="10" step="0.05" value={spacing} onChange={(event) => { setSpacing(Number(event.target.value)); setError(""); }} /><em>m</em></label>
      </div>

      <div className="generator-table" role="table" aria-label="随机元素配置">
        <div className="generator-table-head" role="row"><span>元素类型</span><span>数量</span><span>平面尺寸 (m)</span><span>高度 (m)</span></div>
        {shapes.map((shape) => {
          const values = config[shape.id];
          return <div className={`generator-row ${values.enabled ? "enabled" : ""}`} role="row" key={shape.id}>
            <label className="generator-shape"><input type="checkbox" checked={values.enabled} onChange={(event) => update(shape.id, { enabled: event.target.checked })} /><i>{shape.glyph}</i><span><b>{shape.title}</b><small>{shape.hint}</small></span></label>
            <label><span className="mobile-label">数量</span><input aria-label={`${shape.title}数量`} type="number" min="0" max="200" step="1" disabled={!values.enabled} value={values.count} onChange={(event) => update(shape.id, { count: Number(event.target.value) })} /></label>
            <div className="generator-range"><span className="mobile-label">平面尺寸</span><input aria-label={`${shape.title}最小尺寸`} type="number" min="0.05" step="0.1" disabled={!values.enabled} value={values.minSize} onChange={(event) => update(shape.id, { minSize: Number(event.target.value) })} /><i>—</i><input aria-label={`${shape.title}最大尺寸`} type="number" min="0.05" step="0.1" disabled={!values.enabled} value={values.maxSize} onChange={(event) => update(shape.id, { maxSize: Number(event.target.value) })} /></div>
            <div className="generator-range"><span className="mobile-label">高度</span><input aria-label={`${shape.title}最小高度`} type="number" min="0.05" step="0.1" disabled={!values.enabled} value={values.minHeight} onChange={(event) => update(shape.id, { minHeight: Number(event.target.value) })} /><i>—</i><input aria-label={`${shape.title}最大高度`} type="number" min="0.05" step="0.1" disabled={!values.enabled} value={values.maxHeight} onChange={(event) => update(shape.id, { maxHeight: Number(event.target.value) })} /></div>
          </div>;
        })}
      </div>

      <footer className="generator-footer">
        <div className="generator-summary"><b>{total}</b><span>个元素</span><small>将替换当前内部障碍物，可撤销；外墙与起点保持不变。</small></div>
        {error && <p className="generator-error" role="alert">{error}</p>}
        <button className="generator-cancel" onClick={onClose}>取消</button>
        <button className="generator-submit" onClick={submit}>⚡ 生成地图</button>
      </footer>
    </section>
  </div>;
}
