import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Corner, Pupa, RankBand, SheetInfo, Suspect } from "../types";
import { sheetNeedsCheck } from "../lib/bands";

/** Pan + zoom + click-to-edit canvas.
 *
 *  Controls:
 *    • Mouse wheel / pinch      — zoom anchored at cursor
 *    • Left click (empty)       — add pupa at that position
 *    • Left drag (empty)        — pan (also middle-drag, or ⌃/⌥ + drag)
 *    • Drag a dot               — move it
 *    • Right click              — delete nearest pupa
 *    • Click a dashed ring      — accept a possible miss
 *    • Drag a sheet corner      — adjust the sheet outline
 *    • Arrow keys               — pan
 *    • + / =  /  -              — zoom in / out around current center
 *    • F                        — fit to window
 *    • T / B                    — pan so image TOP / BOTTOM is at viewport center
 *    • ⌘Z / ⇧⌘Z                 — undo / redo dot edits
 *
 *  Edge behaviour (matches label_whole_scan.py fix from 2026-04-16):
 *  when the image is larger than the viewport, pan bounds allow the image
 *  top / bottom to reach the viewport CENTER so the user can always see
 *  and click the extreme edges.
 */

function bandFor(rankPct: number): RankBand {
  if (rankPct < 5) return "0-5%";
  if (rankPct < 25) return "5-25%";
  if (rankPct < 75) return "25-75%";
  return "75-100%";
}

interface Props {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  pupae: Pupa[];
  onChange: (next: Pupa[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
  zoomCommand?: { kind: "in" | "out" | "fit"; nonce: number } | null;
  showRankLines?: boolean;
  sheet?: SheetInfo | null;
  onSheetChange?: (corners: Corner[]) => void;
  suspects?: Suspect[];
  onAcceptSuspect?: (s: Suspect) => void;
  top5?: Set<number>;
}

const HIT_PX = 20;           // right-click delete radius in IMAGE pixels
const DOT_SCREEN_RADIUS = 5; // on-screen dot radius
const DRAG_PX = 4;           // screen px before a press counts as a drag
const RING_ZOOM = 2.5;       // above this zoom dots turn into rings so the pupa stays visible

type Drag =
  | { kind: "pending"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "point"; idx: number; sx: number; sy: number; x: number; y: number; moved: boolean }
  | { kind: "corner"; idx: number; corners: Corner[] };

export function EditCanvas({
  imageDataUrl,
  imageWidth,
  imageHeight,
  pupae,
  onChange,
  onDirtyChange,
  zoomCommand,
  showRankLines = true,
  sheet,
  onSheetChange,
  suspects = [],
  onAcceptSuspect,
  top5,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const undoStack = useRef<Pupa[][]>([]);
  const redoStack = useRef<Pupa[][]>([]);

  // Observe container size.
  useEffect(() => {
    if (!hostRef.current) return;
    const el = hostRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // A new image starts with an empty undo history (otherwise ⌘Z could
  // bring back the previous scan's dots).
  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
  }, [imageDataUrl]);

  const fitZoom = useMemo(() => {
    if (size.w === 0 || size.h === 0 || imageWidth === 0) return 1;
    return Math.min(size.w / imageWidth, size.h / imageHeight);
  }, [size, imageWidth, imageHeight]);

  // On image change or initial mount → start at 2.5× fit so pupae are
  // visible at usable scale (LiDE 300 scans are paper-sized; fit-to-window
  // makes individual pupae ~6 px tall, too small for accurate clicking).
  useEffect(() => {
    if (fitZoom <= 0) return;
    const initialZoom = fitZoom * 2.5;
    setZoom(initialZoom);
    setOffset({
      x: (size.w - imageWidth * initialZoom) / 2,
      y: (size.h - imageHeight * initialZoom) / 2,
    });
  }, [imageDataUrl, fitZoom, size.w, size.h, imageWidth, imageHeight]);

  /** Clamp offset so the image can be panned such that any edge reaches
   *  the viewport centre (but never wholly off-screen). */
  const clampOffset = useCallback(
    (ox: number, oy: number, z: number) => {
      const imgPxW = imageWidth * z;
      const imgPxH = imageHeight * z;
      let nx = ox, ny = oy;
      if (imgPxW < size.w) {
        nx = (size.w - imgPxW) / 2;
      } else {
        nx = Math.max(size.w / 2 - imgPxW, Math.min(size.w / 2, ox));
      }
      if (imgPxH < size.h) {
        ny = (size.h - imgPxH) / 2;
      } else {
        ny = Math.max(size.h / 2 - imgPxH, Math.min(size.h / 2, oy));
      }
      return { x: nx, y: ny };
    },
    [imageWidth, imageHeight, size.w, size.h]
  );

  const toImage = useCallback(
    (clientX: number, clientY: number) => {
      const rect = hostRef.current!.getBoundingClientRect();
      return { x: (clientX - rect.left - offset.x) / zoom, y: (clientY - rect.top - offset.y) / zoom };
    },
    [offset, zoom]
  );

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const minZoom = fitZoom * 0.4;
      const maxZoom = 40;
      const nextZoom = Math.max(minZoom, Math.min(maxZoom, zoom * factor));
      const ratio = nextZoom / zoom;
      const nextOffset = {
        x: cx - (cx - offset.x) * ratio,
        y: cy - (cy - offset.y) * ratio,
      };
      setZoom(nextZoom);
      setOffset(clampOffset(nextOffset.x, nextOffset.y, nextZoom));
    },
    [zoom, offset, fitZoom, clampOffset]
  );

  const fit = useCallback(() => {
    setZoom(fitZoom);
    setOffset({
      x: (size.w - imageWidth * fitZoom) / 2,
      y: (size.h - imageHeight * fitZoom) / 2,
    });
  }, [fitZoom, size, imageWidth, imageHeight]);

  // Handle external zoom commands from the toolbar.
  useEffect(() => {
    if (!zoomCommand) return;
    const cx = size.w / 2;
    const cy = size.h / 2;
    if (zoomCommand.kind === "in") zoomAt(1.4, cx, cy);
    else if (zoomCommand.kind === "out") zoomAt(1 / 1.4, cx, cy);
    else if (zoomCommand.kind === "fit") fit();
  }, [zoomCommand]); // eslint-disable-line react-hooks/exhaustive-deps

  const recomputeRanks = useCallback((list: Pupa[]): Pupa[] => {
    if (list.length === 0) return list;
    const ys = list.map((p) => p.y);
    const yMax = Math.max(...ys);
    const yMin = Math.min(...ys);
    const range = Math.max(1, yMax - yMin);
    return list.map((p, i) => {
      const rank = ((yMax - p.y) / range) * 100;
      return { ...p, index: i + 1, rankPct: Number(rank.toFixed(2)), band: bandFor(rank) };
    });
  }, []);

  const commit = useCallback((next: Pupa[]) => {
    undoStack.current.push(pupae);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    onDirtyChange?.(true);
    onChange(recomputeRanks(next));
  }, [pupae, onChange, onDirtyChange, recomputeRanks]);

  const nearestPupa = useCallback((ix: number, iy: number, radius: number) => {
    let best = -1, bd = radius * radius;
    for (let i = 0; i < pupae.length; i++) {
      const dx = pupae[i].x - ix, dy = pupae[i].y - iy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }, [pupae]);

  // Grab radius: a dot is easy to hit at any zoom.
  // Image pixels per 150-DPI pixel: keeps hit areas and ring sizes the same
  // physical size on 300 / 600 DPI scans.
  const dpiK = Math.max(1, imageWidth / 1240);
  const grabR = Math.max(6 * dpiK, 9 / zoom);

  const corners: Corner[] | null = drag?.kind === "corner"
    ? drag.corners
    : sheet?.found && sheet.corners?.length === 4 ? sheet.corners : null;

  const cornerAt = (ix: number, iy: number) => {
    if (!corners || !onSheetChange) return -1;
    const r = Math.max(8, 12 / zoom);
    return corners.findIndex((c) => Math.hypot(c[0] - ix, c[1] - iy) <= r);
  };
  const suspectAt = (ix: number, iy: number) => {
    const r = Math.max(8, 12 / zoom);
    return suspects.findIndex((s) => Math.hypot(s.x - ix, s.y - iy) <= r);
  };

  const removeNearest = useCallback((ix: number, iy: number) => {
    const i = nearestPupa(ix, iy, HIT_PX);
    if (i < 0) return;
    commit(pupae.filter((_, k) => k !== i));
  }, [nearestPupa, pupae, commit]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(pupae);
    onChange(prev);
  }, [pupae, onChange]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(pupae);
    onChange(next);
  }, [pupae, onChange]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (meta || e.altKey) return;
      const step = 50;
      if (e.key === "ArrowLeft") { setOffset((o) => clampOffset(o.x + step, o.y, zoom)); e.preventDefault(); }
      else if (e.key === "ArrowRight") { setOffset((o) => clampOffset(o.x - step, o.y, zoom)); e.preventDefault(); }
      else if (e.key === "ArrowUp") { setOffset((o) => clampOffset(o.x, o.y + step, zoom)); e.preventDefault(); }
      else if (e.key === "ArrowDown") { setOffset((o) => clampOffset(o.x, o.y - step, zoom)); e.preventDefault(); }
      else if (e.key === "+" || e.key === "=") { zoomAt(1.25, size.w / 2, size.h / 2); e.preventDefault(); }
      else if (e.key === "-" || e.key === "_") { zoomAt(1 / 1.25, size.w / 2, size.h / 2); e.preventDefault(); }
      else if (e.key.toLowerCase() === "f") { fit(); e.preventDefault(); }
      else if (e.key.toLowerCase() === "t") {
        setOffset((o) => clampOffset(o.x, size.h / 2, zoom));
        e.preventDefault();
      } else if (e.key.toLowerCase() === "b") {
        setOffset((o) => clampOffset(o.x, size.h / 2 - imageHeight * zoom, zoom));
        e.preventDefault();
      } else if ((e.key === "Delete" || e.key === "Backspace") && hover) {
        removeNearest(hover.x, hover.y);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, zoomAt, fit, clampOffset, zoom, size.w, size.h, imageHeight, hover, removeNearest]);

  // Native, non-passive wheel listener: React's onWheel is passive, so its
  // preventDefault() was ignored (and logged a console warning).
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (e.button === 2) return;
    if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.altKey))) {
      setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y });
      e.preventDefault();
      return;
    }
    const p = toImage(e.clientX, e.clientY);
    const ci = cornerAt(p.x, p.y);
    if (ci >= 0 && corners) {
      setDrag({ kind: "corner", idx: ci, corners: corners.map((c) => [c[0], c[1]] as Corner) });
      return;
    }
    const pi = nearestPupa(p.x, p.y, grabR);
    if (pi >= 0) {
      setDrag({ kind: "point", idx: pi, sx: e.clientX, sy: e.clientY, x: pupae[pi].x, y: pupae[pi].y, moved: false });
      return;
    }
    setDrag({ kind: "pending", sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y });
  };

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const p = toImage(e.clientX, e.clientY);
    setHover(p);
    if (!drag) return;
    if (drag.kind === "corner") {
      const next = drag.corners.map((c) => [c[0], c[1]] as Corner);
      // A cut-off end may be extrapolated past the scan edge, so allow some slack.
      next[drag.idx] = [
        Math.max(-imageWidth * 0.5, Math.min(imageWidth * 1.5, p.x)),
        Math.max(-imageHeight * 0.5, Math.min(imageHeight * 1.5, p.y)),
      ];
      setDrag({ ...drag, corners: next });
      return;
    }
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.kind === "pending" && Math.hypot(dx, dy) > DRAG_PX) {
      setDrag({ ...drag, kind: "pan" });
    } else if (drag.kind === "pan") {
      setOffset(clampOffset(drag.ox + dx, drag.oy + dy, zoom));
    } else if (drag.kind === "point") {
      setDrag({
        ...drag,
        moved: drag.moved || Math.hypot(dx, dy) > DRAG_PX,
        x: Math.max(0, Math.min(imageWidth - 1, p.x)),
        y: Math.max(0, Math.min(imageHeight - 1, p.y)),
      });
    }
  };

  const onMouseUp: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!drag) return;
    const p = toImage(e.clientX, e.clientY);
    if (drag.kind === "pending") {
      // A click (not a drag) on empty image adds a dot; on a dashed ring it
      // accepts that possible miss.
      const si = suspectAt(p.x, p.y);
      if (si >= 0 && onAcceptSuspect) onAcceptSuspect(suspects[si]);
      else if (p.x >= 0 && p.x <= imageWidth && p.y >= 0 && p.y <= imageHeight) {
        commit([...pupae, {
          index: pupae.length + 1, x: Math.round(p.x), y: Math.round(p.y),
          rankPct: 0, band: "25-75%", source: "manual",
        }]);
      }
    } else if (drag.kind === "point" && drag.moved) {
      commit(pupae.map((q, i) => (i === drag.idx
        ? { ...q, x: Math.round(drag.x), y: Math.round(drag.y), source: "manual" as const }
        : q)));
    } else if (drag.kind === "corner" && onSheetChange) {
      onSheetChange(drag.corners.map((c) => [Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10] as Corner));
    }
    setDrag(null);
  };

  const onContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const p = toImage(e.clientX, e.clientY);
    removeNearest(p.x, p.y);
  };

  const shown = drag?.kind === "point" && drag.moved
    ? pupae.map((q, i) => (i === drag.idx ? { ...q, x: drag.x, y: drag.y } : q))
    : pupae;
  const hoverIdx = hover && !drag ? nearestPupa(hover.x, hover.y, grabR) : -1;
  const rings = zoom * dpiK >= RING_ZOOM;
  const ringR = Math.max(7, Math.round(7 * imageWidth / 1240)); // ≈ half a pupa at any DPI (7 px at 150 DPI)
  const lowSheet = sheetNeedsCheck(sheet);

  let cursor = "crosshair";
  if (drag && drag.kind !== "pending") cursor = "grabbing";
  else if (hover && (hoverIdx >= 0 || cornerAt(hover.x, hover.y) >= 0)) cursor = "grab";
  else if (hover && suspectAt(hover.x, hover.y) >= 0) cursor = "copy";

  return (
    <div
      ref={hostRef}
      className="edit-canvas-host"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={(e) => { if (drag) onMouseUp(e); setHover(null); }}
      onContextMenu={onContextMenu}
      style={{ cursor }}
    >
      <div
        className="edit-canvas-inner"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          width: imageWidth,
          height: imageHeight,
        }}
      >
        <img
          src={imageDataUrl}
          alt="scan"
          draggable={false}
          width={imageWidth}
          height={imageHeight}
          style={{ display: "block", userSelect: "none", pointerEvents: "none" }}
        />
        <svg
          width={imageWidth}
          height={imageHeight}
          viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", overflow: "visible" }}
        >
          {showRankLines && shown.length > 0 && (() => {
            const ys = shown.map((p) => p.y);
            const yMax = Math.max(...ys);
            const yMin = Math.min(...ys);
            const range = Math.max(1, yMax - yMin);
            const lineY = (p: number) => yMax - (p / 100) * range;
            const strokeW = 1.2 / zoom;
            const dash = `${6 / zoom} ${4 / zoom}`;
            const fontSize = 10 / zoom;
            return (
              <g style={{ pointerEvents: "none" }}>
                <line x1={0} x2={imageWidth} y1={lineY(5)} y2={lineY(5)}
                  stroke="#B4362E" strokeWidth={strokeW} strokeDasharray={dash} opacity={0.85} />
                <text x={6} y={lineY(5) - 4 / zoom} fontSize={fontSize} fill="#B4362E"
                  fontFamily="ui-monospace, SF Mono, monospace" fontWeight={600}>RANK 5%</text>
                <line x1={0} x2={imageWidth} y1={lineY(25)} y2={lineY(25)}
                  stroke="#C77A1D" strokeWidth={strokeW} strokeDasharray={dash} opacity={0.8} />
                <text x={6} y={lineY(25) - 4 / zoom} fontSize={fontSize} fill="#C77A1D"
                  fontFamily="ui-monospace, SF Mono, monospace" fontWeight={600}>RANK 25%</text>
                <line x1={0} x2={imageWidth} y1={lineY(75)} y2={lineY(75)}
                  stroke="#C77A1D" strokeWidth={strokeW} strokeDasharray={dash} opacity={0.8} />
                <text x={6} y={lineY(75) - 4 / zoom} fontSize={fontSize} fill="#C77A1D"
                  fontFamily="ui-monospace, SF Mono, monospace" fontWeight={600}>RANK 75%</text>
              </g>
            );
          })()}

          {corners && (() => {
            const [tl, tr, br, bl] = corners;
            const top = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
            const bot = [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2];
            const color = lowSheet ? "var(--warn)" : "var(--accent)";
            const fs = 10 / zoom;
            return (
              <g>
                <polygon points={corners.map((c) => c.join(",")).join(" ")}
                  fill="none" stroke={color} strokeWidth={(lowSheet ? 2 : 1.5) / zoom}
                  strokeDasharray={lowSheet ? `${7 / zoom} ${4 / zoom}` : undefined} />
                <text x={top[0]} y={top[1] - 5 / zoom} fontSize={fs} textAnchor="middle" fill={color}
                  fontFamily="ui-monospace, SF Mono, monospace" fontWeight={600}>SHEET TOP · 100</text>
                <text x={bot[0]} y={bot[1] + 13 / zoom} fontSize={fs} textAnchor="middle" fill={color}
                  fontFamily="ui-monospace, SF Mono, monospace" fontWeight={600}>SHEET BOTTOM · 0</text>
                {onSheetChange && corners.map((c, i) => (
                  <rect key={i} x={c[0] - 5 / zoom} y={c[1] - 5 / zoom} width={10 / zoom} height={10 / zoom}
                    rx={2 / zoom} fill="var(--panel)" stroke={color} strokeWidth={1.6 / zoom} />
                ))}
              </g>
            );
          })()}

          {suspects.map((s, i) => (
            <circle key={`s${i}`} cx={s.x} cy={s.y} r={Math.max(ringR, 8 / zoom)} fill="none"
              stroke="#C77A1D" strokeWidth={1.4 / zoom} strokeDasharray={`${3 / zoom} ${2 / zoom}`} />
          ))}

          {shown.map((p, i) => {
            const color = p.source === "manual" ? "#1F5F6B" : "#2BA557";
            const hot = i === hoverIdx;
            return (
              <g key={i + ":" + p.x + ":" + p.y}>
                {top5?.has(i) && (
                  <circle cx={p.x} cy={p.y} r={rings ? ringR + 2.5 : DOT_SCREEN_RADIUS / zoom + 3.5 / zoom}
                    fill="none" stroke="#B4362E" strokeWidth={1.8 / zoom} />
                )}
                {rings ? (
                  // Zoomed in: hollow ring + centre mark so the pupa itself stays visible.
                  <>
                    <circle cx={p.x} cy={p.y} r={ringR} fill={hot ? color : "none"} fillOpacity={0.18}
                      stroke="white" strokeWidth={3 / zoom} opacity={0.7} />
                    <circle cx={p.x} cy={p.y} r={ringR} fill="none" stroke={color} strokeWidth={1.6 / zoom} />
                    <circle cx={p.x} cy={p.y} r={1.2 / zoom} fill={color} />
                  </>
                ) : (
                  <circle cx={p.x} cy={p.y} r={(hot ? 1.3 : 1) * DOT_SCREEN_RADIUS / zoom}
                    fill={color} stroke="white" strokeWidth={1.2 / zoom} />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="edit-canvas-hud">
        <span className="mono">zoom {(zoom * 100).toFixed(0)}%</span>
        <span className="sep">·</span>
        <span className="mono">{pupae.length} pupae</span>
        <span className="sep">·</span>
        <span>Click add · drag move/pan · right-click delete · +/− zoom · F fit · T/B top/bot · ⌘Z undo</span>
      </div>
    </div>
  );
}
