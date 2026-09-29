import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Corner, Pupa, SheetInfo, Suspect } from "../types";
import type { Overlays } from "../store/settingsStore";

/** Pan / zoom / edit canvas for one scan.
 *
 *  Mouse
 *    click empty area      add a pupa
 *    drag empty area       pan (also: middle button, or hold Space… no: Space scans)
 *    drag a pupa           move it
 *    right-click a pupa    delete it
 *    click a dashed ring   accept a possible miss
 *    drag a sheet corner   adjust the sheet outline
 *    wheel / pinch         zoom at the cursor
 *  Keys (when no text field has focus)
 *    + / −  zoom · F fit · 1 100 % · arrows pan · T / B jump to top / bottom
 *    D or Delete           delete the pupa under the cursor
 */

export interface ZoomCommand { kind: "in" | "out" | "fit" | "actual"; nonce: number }

interface Props {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  pupae: Pupa[];
  suspects: Suspect[];
  sheet: SheetInfo | null;
  top5: Set<number>;
  overlays: Overlays;
  onEdit: (next: Pupa[]) => void;
  onSheet: (corners: Corner[]) => void;
  onAcceptSuspect: (s: Suspect) => void;
  zoomCommand: ZoomCommand | null;
  onZoomChange?: (zoom: number) => void;
}

type Drag =
  | { kind: "pending"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "point"; idx: number; sx: number; sy: number; x: number; y: number; moved: boolean }
  | { kind: "corner"; idx: number; corners: Corner[] };

const MOVE_THRESHOLD = 4;

export function EditCanvas(props: Props) {
  const {
    imageDataUrl, imageWidth, imageHeight, pupae, suspects, sheet, top5, overlays,
    onEdit, onSheet, onAcceptSuspect, zoomCommand, onZoomChange,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const viewKey = useRef<string>("");

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => { onZoomChange?.(zoom); }, [zoom, onZoomChange]);

  const fitZoom = useMemo(() => {
    if (!size.w || !size.h || !imageWidth || !imageHeight) return 1;
    return Math.min(size.w / imageWidth, size.h / imageHeight);
  }, [size, imageWidth, imageHeight]);

  const clampOffset = useCallback((ox: number, oy: number, z: number) => {
    const iw = imageWidth * z, ih = imageHeight * z;
    const nx = iw < size.w ? (size.w - iw) / 2 : Math.max(size.w / 2 - iw, Math.min(size.w / 2, ox));
    const ny = ih < size.h ? (size.h - ih) / 2 : Math.max(size.h / 2 - ih, Math.min(size.h / 2, oy));
    return { x: nx, y: ny };
  }, [imageWidth, imageHeight, size.w, size.h]);

  const centerOn = useCallback((ix: number, iy: number, z: number) => {
    setZoom(z);
    setOffset(clampOffset(size.w / 2 - ix * z, size.h / 2 - iy * z, z));
  }, [clampOffset, size.w, size.h]);

  // New image → open at a usable working zoom (pupae ≈ 15 px on screen),
  // centred on the pupae / sheet rather than the empty scanner bed.
  useEffect(() => {
    if (!size.w || !size.h) return;
    const key = `${imageDataUrl.length}:${imageDataUrl.slice(-64)}:${imageWidth}x${imageHeight}`;
    if (viewKey.current === key) return;
    viewKey.current = key;
    const pts: [number, number][] = sheet?.found && sheet.corners.length === 4
      ? sheet.corners
      : pupae.map((p) => [p.x, p.y] as [number, number]);
    let cx = imageWidth / 2, cy = imageHeight / 2;
    if (pts.length) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    centerOn(cx, cy, fitZoom * 2.5);
  }, [imageDataUrl, imageWidth, imageHeight, size.w, size.h, fitZoom, centerOn, sheet, pupae]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setZoom((z) => {
      const next = Math.max(fitZoom * 0.5, Math.min(40, z * factor));
      const r = next / z;
      setOffset((o) => clampOffset(cx - (cx - o.x) * r, cy - (cy - o.y) * r, next));
      return next;
    });
  }, [fitZoom, clampOffset]);

  const fit = useCallback(() => {
    setZoom(fitZoom);
    setOffset({ x: (size.w - imageWidth * fitZoom) / 2, y: (size.h - imageHeight * fitZoom) / 2 });
  }, [fitZoom, size, imageWidth, imageHeight]);

  useEffect(() => {
    if (!zoomCommand) return;
    const cx = size.w / 2, cy = size.h / 2;
    if (zoomCommand.kind === "in") zoomAt(1.35, cx, cy);
    else if (zoomCommand.kind === "out") zoomAt(1 / 1.35, cx, cy);
    else if (zoomCommand.kind === "fit") fit();
    else if (zoomCommand.kind === "actual") zoomAt(1 / zoom, cx, cy);
  }, [zoomCommand]); // eslint-disable-line react-hooks/exhaustive-deps

  const toImage = useCallback((clientX: number, clientY: number) => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - offset.x) / zoom, y: (clientY - r.top - offset.y) / zoom };
  }, [offset, zoom]);

  const hitRadius = Math.max(6, 12 / zoom);

  const nearestPupa = useCallback((ix: number, iy: number, radius = hitRadius) => {
    let best = -1, bd = radius * radius;
    for (let i = 0; i < pupae.length; i++) {
      const dx = pupae[i].x - ix, dy = pupae[i].y - iy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }, [pupae, hitRadius]);

  const corners: Corner[] | null = drag?.kind === "corner"
    ? drag.corners
    : sheet?.found && sheet.corners?.length === 4 ? sheet.corners : null;

  const nearestCorner = (ix: number, iy: number) => {
    if (!corners || !overlays.sheet) return -1;
    const r = Math.max(8, 14 / zoom);
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(corners[i][0] - ix, corners[i][1] - iy) <= r) return i;
    }
    return -1;
  };

  const nearestSuspect = (ix: number, iy: number) => {
    if (!overlays.suspects) return -1;
    const r = Math.max(8, 14 / zoom);
    for (let i = 0; i < suspects.length; i++) {
      if (Math.hypot(suspects[i].x - ix, suspects[i].y - iy) <= r) return i;
    }
    return -1;
  };

  const deleteAt = useCallback((ix: number, iy: number) => {
    const i = nearestPupa(ix, iy, Math.max(hitRadius, 10));
    if (i < 0) return false;
    onEdit(pupae.filter((_, k) => k !== i));
    return true;
  }, [nearestPupa, hitRadius, onEdit, pupae]);

  // Keyboard (canvas-local shortcuts; global ones live in ScanView).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = 60;
      const k = e.key;
      if (k === "ArrowLeft") setOffset((o) => clampOffset(o.x + step, o.y, zoom));
      else if (k === "ArrowRight") setOffset((o) => clampOffset(o.x - step, o.y, zoom));
      else if (k === "ArrowUp") setOffset((o) => clampOffset(o.x, o.y + step, zoom));
      else if (k === "ArrowDown") setOffset((o) => clampOffset(o.x, o.y - step, zoom));
      else if (k === "+" || k === "=") zoomAt(1.25, size.w / 2, size.h / 2);
      else if (k === "-" || k === "_") zoomAt(1 / 1.25, size.w / 2, size.h / 2);
      else if (k === "f" || k === "F") fit();
      else if (k === "1") zoomAt(1 / zoom, size.w / 2, size.h / 2);
      else if (k === "t" || k === "T") setOffset((o) => clampOffset(o.x, size.h / 2, zoom));
      else if (k === "b" || k === "B") setOffset((o) => clampOffset(o.x, size.h / 2 - imageHeight * zoom, zoom));
      else if ((k === "d" || k === "D" || k === "Delete" || k === "Backspace") && hover) deleteAt(hover.x, hover.y);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt, fit, clampOffset, zoom, size.w, size.h, imageHeight, hover, deleteAt]);

  // Native wheel listener (React's is passive, so preventDefault fails).
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const scale = e.ctrlKey ? 0.01 : 0.0015; // pinch gestures arrive as ctrl+wheel
      zoomAt(Math.exp(-e.deltaY * scale), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return;
    const p = toImage(e.clientX, e.clientY);
    if (e.button === 1) {
      setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y });
      e.preventDefault();
      return;
    }
    const ci = nearestCorner(p.x, p.y);
    if (ci >= 0 && corners) {
      setDrag({ kind: "corner", idx: ci, corners: corners.map((c) => [c[0], c[1]] as Corner) });
      return;
    }
    const pi = nearestPupa(p.x, p.y);
    if (pi >= 0) {
      setDrag({ kind: "point", idx: pi, sx: e.clientX, sy: e.clientY, x: pupae[pi].x, y: pupae[pi].y, moved: false });
      return;
    }
    setDrag({ kind: "pending", sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const p = toImage(e.clientX, e.clientY);
    setHover(p);
    if (!drag) return;
    const dx = e.clientX - (drag as any).sx, dy = e.clientY - (drag as any).sy;
    if (drag.kind === "pending" && Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      setDrag({ ...drag, kind: "pan" });
    } else if (drag.kind === "pan") {
      setOffset(clampOffset(drag.ox + dx, drag.oy + dy, zoom));
    } else if (drag.kind === "point") {
      const moved = drag.moved || Math.hypot(dx, dy) > MOVE_THRESHOLD;
      setDrag({ ...drag, moved, x: clamp(p.x, 0, imageWidth - 1), y: clamp(p.y, 0, imageHeight - 1) });
    } else if (drag.kind === "corner") {
      const next = drag.corners.map((c) => [c[0], c[1]] as Corner);
      // Corners may sit outside the scan (a cut-off end is extrapolated).
      next[drag.idx] = [clamp(p.x, -imageWidth * 0.5, imageWidth * 1.5), clamp(p.y, -imageHeight * 0.5, imageHeight * 1.5)];
      setDrag({ ...drag, corners: next });
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (!drag) return;
    const p = toImage(e.clientX, e.clientY);
    if (drag.kind === "pending") {
      const si = nearestSuspect(p.x, p.y);
      if (si >= 0) onAcceptSuspect(suspects[si]);
      else if (p.x >= 0 && p.y >= 0 && p.x < imageWidth && p.y < imageHeight) {
        onEdit([...pupae, {
          index: pupae.length + 1, x: Math.round(p.x), y: Math.round(p.y),
          rankPct: 0, band: "25-75%", source: "manual",
        }]);
      }
    } else if (drag.kind === "point" && drag.moved) {
      const next = pupae.map((q, i) => i === drag.idx
        ? { ...q, x: Math.round(drag.x), y: Math.round(drag.y), source: "manual" as const }
        : q);
      onEdit(next);
    } else if (drag.kind === "corner") {
      onSheet(drag.corners.map((c) => [Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10] as Corner));
    }
    setDrag(null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = toImage(e.clientX, e.clientY);
    deleteAt(p.x, p.y);
  };

  // --- drawing -------------------------------------------------------------------
  const shown = drag?.kind === "point" && drag.moved
    ? pupae.map((q, i) => (i === drag.idx ? { ...q, x: drag.x, y: drag.y } : q))
    : pupae;
  const hoverIdx = hover && !drag ? nearestPupa(hover.x, hover.y) : -1;
  // Marker size: ~ one pupa (≈ 15 px long at 150 DPI), never tiny on screen.
  const pxPerDpi = imageWidth > 2000 ? 2 : 1;
  const ringR = Math.max(7 * pxPerDpi, 6 / zoom);
  const r = ringR;
  const sw = 1.3 / zoom;

  const rankLines = overlays.bands && shown.length > 1 ? (() => {
    const ys = shown.map((p) => p.y);
    const yMax = Math.max(...ys), yMin = Math.min(...ys), range = Math.max(1, yMax - yMin);
    return [5, 25, 75].map((pct) => ({ pct, y: yMax - (pct / 100) * range }));
  })() : [];

  let cursor = "crosshair";
  if (drag?.kind === "pan") cursor = "grabbing";
  else if (drag?.kind === "point" || drag?.kind === "corner") cursor = "grabbing";
  else if (hover && (nearestCorner(hover.x, hover.y) >= 0 || hoverIdx >= 0)) cursor = "grab";
  else if (hover && nearestSuspect(hover.x, hover.y) >= 0) cursor = "copy";

  return (
    <div
      ref={hostRef}
      className="canvas-host"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={(e) => { if (drag) onMouseUp(e); setHover(null); }}
      onContextMenu={onContextMenu}
      style={{ cursor }}
      data-testid="edit-canvas"
    >
      <div
        className="canvas-inner"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, width: imageWidth, height: imageHeight }}
      >
        <img src={imageDataUrl} alt="Scanned sheet" draggable={false} width={imageWidth} height={imageHeight} />
        <svg className="canvas-overlay" width={imageWidth} height={imageHeight} viewBox={`0 0 ${imageWidth} ${imageHeight}`}>
          {rankLines.map((l) => (
            <g key={l.pct}>
              <line x1={0} x2={imageWidth} y1={l.y} y2={l.y} stroke="var(--mark-band)" strokeWidth={sw}
                strokeDasharray={`${6 / zoom} ${4 / zoom}`} opacity={l.pct === 5 ? 0.9 : 0.55} />
              <text x={6 / zoom} y={l.y - 4 / zoom} fontSize={10 / zoom} fill="var(--mark-band)"
                fontFamily="var(--font-mono)" fontWeight={600} opacity={l.pct === 5 ? 1 : 0.7}>
                rank {l.pct}%
              </text>
            </g>
          ))}

          {corners && overlays.sheet && (
            <SheetOverlay corners={corners} zoom={zoom} low={!sheet?.manual && ((sheet?.confidence ?? 0) < 0.5 || !!sheet?.truncatedTop || !!sheet?.truncatedBottom)} />
          )}

          {overlays.suspects && suspects.map((s, i) => (
            <circle key={`s${i}`} cx={s.x} cy={s.y} r={r * 1.25} fill="none" stroke="var(--mark-suspect)"
              strokeWidth={1.6 / zoom} strokeDasharray={`${3 / zoom} ${2 / zoom}`} />
          ))}

          {shown.map((p, i) => {
            const isTop = overlays.top5 && top5.has(i);
            const low = p.source === "cnn" && p.prob != null && p.prob < 0.7;
            // Hollow ring + centre dot so the pupa itself stays visible for review.
            const col = p.source === "manual" ? "var(--mark-manual)" : "var(--mark-cnn)";
            const rr = (i === hoverIdx ? 1.3 : 1) * ringR;
            return (
              <g key={`${i}:${p.x}:${p.y}`}>
                {isTop && <circle cx={p.x} cy={p.y} r={rr + 4 / zoom} fill="none" stroke="var(--mark-top5)" strokeWidth={2.2 / zoom} />}
                <circle cx={p.x} cy={p.y} r={rr} fill="none" stroke="var(--mark-ring)" strokeWidth={3.4 / zoom} opacity={0.55} />
                <circle cx={p.x} cy={p.y} r={rr} fill={i === hoverIdx ? col : "none"} fillOpacity={0.25}
                  stroke={low ? "var(--mark-suspect)" : col} strokeWidth={1.8 / zoom}
                  strokeDasharray={low ? `${2.5 / zoom} ${1.5 / zoom}` : undefined} />
                <circle cx={p.x} cy={p.y} r={1.3 / zoom} fill={col} />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="hud">
        <span>{Math.round(zoom * 100)}%</span>
        {hover && hover.x >= 0 && hover.y >= 0 && hover.x < imageWidth && hover.y < imageHeight && (
          <span>x {Math.round(hover.x)} · y {Math.round(hover.y)}</span>
        )}
      </div>
    </div>
  );
}

function SheetOverlay({ corners, zoom, low }: { corners: Corner[]; zoom: number; low: boolean }) {
  const [tl, tr, br, bl] = corners;
  const top = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
  const bot = [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2];
  const fs = 11 / zoom;
  const ticks = [25, 50, 75].map((t) => {
    const f = t / 100;
    const a = [bl[0] + (tl[0] - bl[0]) * f, bl[1] + (tl[1] - bl[1]) * f];
    const b = [br[0] + (tr[0] - br[0]) * f, br[1] + (tr[1] - br[1]) * f];
    return { t, a, b };
  });
  return (
    <g>
      <polygon points={corners.map((c) => c.join(",")).join(" ")} fill="var(--mark-sheet)" fillOpacity={0.05}
        stroke="var(--mark-sheet)" strokeWidth={(low ? 2.4 : 1.6) / zoom}
        strokeDasharray={low ? `${8 / zoom} ${5 / zoom}` : undefined} />
      {ticks.map(({ t, a, b }) => (
        <g key={t}>
          <line x1={a[0]} y1={a[1]} x2={a[0] + (b[0] - a[0]) * 0.08} y2={a[1] + (b[1] - a[1]) * 0.08}
            stroke="var(--mark-sheet)" strokeWidth={1.4 / zoom} />
          <text x={a[0] - 4 / zoom} y={a[1] + 3.5 / zoom} fontSize={fs * 0.85} textAnchor="end"
            fill="var(--mark-sheet)" fontFamily="var(--font-mono)">{t}</text>
        </g>
      ))}
      <text x={top[0]} y={top[1] - 6 / zoom} fontSize={fs} textAnchor="middle" fill="var(--mark-sheet)"
        fontFamily="var(--font-mono)" fontWeight={600}>sheet top · 100</text>
      <text x={bot[0]} y={bot[1] + 14 / zoom} fontSize={fs} textAnchor="middle" fill="var(--mark-sheet)"
        fontFamily="var(--font-mono)" fontWeight={600}>sheet bottom · 0</text>
      {corners.map((c, i) => (
        <rect key={i} x={c[0] - 6 / zoom} y={c[1] - 6 / zoom} width={12 / zoom} height={12 / zoom} rx={2 / zoom}
          fill="var(--surface)" stroke="var(--mark-sheet)" strokeWidth={2 / zoom} />
      ))}
    </g>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
