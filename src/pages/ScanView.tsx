import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icons, SheetGlyph } from "../components/icons";
import { EditCanvas, type ZoomCommand } from "../components/EditCanvas";
import { MetaForm } from "../components/MetaForm";
import { currentReplicate, useSessionStore } from "../store/sessionStore";
import { useSettings } from "../store/settingsStore";
import { useUi } from "../store/uiStore";
import { scanNow, loadScanFromPath, pickImageFile, getImageDims, type ScanHandle } from "../adapters/scannerAdapter";
import { runDetection, isMockModel } from "../adapters/cnnAdapter";
import { recordTop5, top5Count, top5Indices } from "../lib/bands";
import type { Corner, ScanRecord } from "../types";

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function ScanView() {
  const s = useSessionStore();
  const { session, work, stage, stageDetail, error, draftMeta } = s;
  const rep = currentReplicate(s);
  const overlays = useSettings((x) => x.overlays);
  const setOverlay = useSettings((x) => x.setOverlay);
  const toast = useUi((x) => x.toast);
  const setShortcutsOpen = useUi((x) => x.setShortcutsOpen);
  const [zoomCmd, setZoomCmd] = useState<ZoomCommand | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const busy = stage === "scanning" || stage === "detecting";
  const busyRef = useRef(false);
  busyRef.current = busy;

  // ---- flow: scan / import → count → auto-save ------------------------------------
  const count = useCallback(async (handle: ScanHandle) => {
    const st = useSessionStore.getState();
    st.setError(null);
    st.setStage("detecting", "Counting pupae…");
    try {
      const det = await runDetection(handle.path, { dpi: handle.actualDpi ?? null, width: handle.width, height: handle.height });
      const mock = isMockModel(det.modelVersion);
      const rec = st.acceptDetection({
        imagePath: handle.path,
        imageDataUrl: handle.dataUrl,
        requestedDpi: handle.requestedDpi ?? null,
        actualDpi: handle.actualDpi ?? null,
        dpiSource: handle.dpiSource ?? null,
      }, det, mock);
      if (!mock) {
        const r = currentReplicate(useSessionStore.getState());
        toast(`Scan ${rec.imageNumber} saved to replicate ${r.replicateNumber} · ${rec.totalPupae} pupae`);
      }
      if (handle.warnings?.length) toast(`Scanner: ${handle.warnings[0]}`, "warn");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useSessionStore.getState().setError(msg);
      useSessionStore.getState().setStage(useSessionStore.getState().work ? "ready" : "idle");
    }
  }, [toast]);

  const doScan = useCallback(async () => {
    if (busyRef.current) return;
    const st = useSessionStore.getState();
    st.setError(null);
    st.setStage("scanning", "Scanning… keep the lid closed");
    try {
      const handle = await scanNow();
      if (!handle) { st.setStage(st.work ? "ready" : "idle"); return; }
      await count(handle);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      st.setError(`Scan failed: ${msg}`);
      st.setStage(st.work ? "ready" : "idle");
    }
  }, [count, toast]);

  const doImport = useCallback(async () => {
    if (busyRef.current) return;
    const handle = await pickImageFile();
    if (handle) await count(handle);
  }, [count]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file || busyRef.current) return;
    const path = window.pupa?.file.pathForFile(file) || "";
    if (path) {
      const h = await loadScanFromPath(path);
      if (h) await count(h);
      return;
    }
    const url = URL.createObjectURL(file);
    const dims = await getImageDims(url);
    await count({ path: file.name, dataUrl: url, ...dims });
  };

  const openScan = useCallback(async (rec: ScanRecord) => {
    if (busyRef.current) return;
    let url: string | null = null;
    try {
      if (window.pupa && (await window.pupa.file.exists(rec.imagePath))) {
        url = await window.pupa.file.readImageDataUrl(rec.imagePath);
      }
    } catch { url = null; }
    useSessionStore.getState().openRecord(rec, url);
    if (!url) toast(`Image file not found on this computer: ${rec.imagePath}`, "warn");
  }, [toast]);

  const discard = () => {
    const st = useSessionStore.getState();
    const rec = st.work?.record;
    st.discardWork();
    if (rec && st.work?.persisted !== false) {
      toast(`Removed scan ${rec.imageNumber} from replicate ${rec.replicateNumber}`, "warn",
        { label: "Undo", run: () => useSessionStore.getState().restoreDiscarded() });
    }
  };

  // ---- keyboard ------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().tab !== "Scan") return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (mod && k === "y") { e.preventDefault(); s.redo(); return; }
      if (mod && k === "o") { e.preventDefault(); doImport(); return; }
      if (mod && e.shiftKey && k === "n") { e.preventDefault(); s.startNewReplicate(); toast("Started a new replicate"); return; }
      if (isTyping(e) || mod || e.altKey) return;
      if (e.code === "Space") { e.preventDefault(); doScan(); return; }
      if (k === "s") { setOverlay("sheet", !useSettings.getState().overlays.sheet); return; }
      if (k === "m") { setOverlay("suspects", !useSettings.getState().overlays.suspects); return; }
      if (k === "l") { setOverlay("bands", !useSettings.getState().overlays.bands); return; }
      if (k === "?" || (e.shiftKey && k === "/")) { setShortcutsOpen(true); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, doImport, doScan, toast, setOverlay, setShortcutsOpen]);

  // Test hook for the screenshot tour (electron/tour.js).
  useEffect(() => {
    window.__pupaDebug = {
      ...(window.__pupaDebug ?? {}),
      // opts simulates what a scanner reports (e.g. asked 300, delivered 150).
      importPath: async (p: string, opts?: { requestedDpi?: number; actualDpi?: number }) => {
        const h = await loadScanFromPath(p);
        if (h) await count({ ...h, ...(opts ?? {}), dpiSource: opts?.actualDpi ? "simulated scanner" : undefined });
      },
      setSheet: (c: Corner[]) => useSessionStore.getState().setSheetCorners(c, true),
      pupae: () => useSessionStore.getState().work?.record.pupae.map((p) => ({ x: p.x, y: p.y, rankPct: p.rankPct, sheetPct: p.sheetPct })),
      scan: () => doScan(),
    };
  }, [count, doScan]);

  // ---- derived numbers -------------------------------------------------------------------
  const rec = work?.record ?? null;
  const top5 = useMemo(() => (rec ? top5Indices(rec.pupae) : new Set<number>()), [rec]);
  const repTotal = rep.scans.reduce((a, x) => a + x.totalPupae, 0);
  const repTop5 = rep.scans.reduce((a, x) => a + recordTop5(x), 0);
  const allScans = session.replicates.flatMap((r) => r.scans);
  const sessTotal = allScans.reduce((a, x) => a + x.totalPupae, 0);
  const sessTop5 = allScans.reduce((a, x) => a + recordTop5(x), 0);
  const inCurrentRep = !rec || rec.replicateNumber === rep.replicateNumber;

  const banners: React.ReactNode[] = [];
  if (work?.mock) {
    banners.push(<div key="mock" className="banner bad"><b>Preview only.</b> The counting engine is not connected, so these dots are made up and nothing is saved.</div>);
  }
  if (rec && rec.requestedDpi && rec.actualDpi && Math.abs(rec.requestedDpi - rec.actualDpi) > 2) {
    banners.push(
      <div key="dpi" className="banner warn">
        <span><b>Scanner delivered {rec.actualDpi} DPI, not the {rec.requestedDpi} DPI you asked for.</b> Counts are fine — the image is rescaled for the model — but check the scanner driver if you need full resolution.</span>
      </div>
    );
  }
  if (rec && work?.imageDataUrl) {
    const sh = rec.sheet;
    if (!sh || !sh.found) {
      banners.push(
        <div key="sheet" className="banner warn">
          <span><b>Sheet outline not found.</b> Sheet position (0 = bottom, 100 = top) can't be computed until you place it.</span>
          <button className="btn btn-sm" onClick={() => s.setSheetCorners(defaultCorners(rec), true)}>Place outline</button>
        </div>
      );
    } else if (!sh.manual && ((sh.confidence ?? 0) < 0.5 || sh.truncatedTop || sh.truncatedBottom)) {
      const why = sh.truncatedTop ? "the top end looks cut off by the scan edge"
        : sh.truncatedBottom ? "the bottom end looks cut off by the scan edge"
        : `low confidence (${Math.round((sh.confidence ?? 0) * 100)}%)`;
      banners.push(
        <div key="sheet" className="banner info">
          <span><b>Check the sheet outline</b> — {why}. Drag the four corner handles onto the sheet edges.</span>
          <button className="btn btn-sm" onClick={() => s.setSheetCorners(sh.corners, true)}>Looks right</button>
        </div>
      );
    }
  }
  if (error && !busy) {
    banners.push(
      <div key="err" className="banner bad" role="alert">
        <span>{error}</span>
        <button className="iconbtn" style={{ width: 24, height: 24 }} title="Dismiss" onClick={() => s.setError(null)}>{Icons.x}</button>
      </div>
    );
  }

  const edits = rec ? {
    added: rec.pupae.filter((p) => p.source === "manual").length,
    removed: Math.max(0, (rec.cnnCount ?? rec.pupae.filter((p) => p.source === "cnn").length) - rec.pupae.filter((p) => p.source === "cnn").length),
  } : { added: 0, removed: 0 };

  return (
    <div className="ws">
      {/* ---------------- replicate ledger ---------------- */}
      <aside className="ledger" aria-label="Replicate">
        <section className="panel-sec">
          <div className="rep-head">
            <div className="title">Replicate <span className="n">{rep.replicateNumber}</span></div>
            {session.replicates.length > 1 && (
              <select className="select rep-select" value={rep.replicateId} aria-label="Switch replicate"
                onChange={(e) => s.selectReplicate(e.target.value)}>
                {session.replicates.map((r) => <option key={r.replicateId} value={r.replicateId}>Replicate {r.replicateNumber}</option>)}
              </select>
            )}
          </div>
          <div className="tally">
            <div><span className="k">Pupae</span><span className="v" data-testid="rep-total">{repTotal.toLocaleString()}</span><span className="sub">this replicate</span></div>
            <div><span className="k">Top 5%</span><span className="v top5" data-testid="rep-top5">{repTop5.toLocaleString()}</span><span className="sub">this replicate</span></div>
            <div className="wide"><span className="k">Session</span><span className="v num">{sessTotal.toLocaleString()} <span className="muted">·</span> <span style={{ color: "var(--mark-top5)" }}>{sessTop5.toLocaleString()}</span></span></div>
          </div>
          <button className="btn" onClick={() => { s.startNewReplicate(); toast("Started a new replicate — labels reset to defaults"); }}
            title={`New replicate (${MOD}+Shift+N)`}>
            {Icons.plus} New replicate
          </button>
        </section>
        <section className="panel-sec" style={{ flex: 1 }}>
          <h3>Scans <span className="num" style={{ fontWeight: 500 }}>{rep.scans.length}</span></h3>
          <div className="scanlist">
            {rep.scans.length === 0 && <div className="empty">No scans yet. Put a sheet on the glass and press Space.</div>}
            {[...rep.scans].reverse().map((x) => (
              <div key={x.id} className={`row${rec?.id === x.id ? " on" : ""}`} onClick={() => openScan(x)} title={x.imagePath}>
                <span className="i">{x.imageNumber}</span>
                <span className="g">{x.genotype || "—"}{x.comments ? ` · ${x.comments}` : ""}</span>
                <span className="t">{x.totalPupae}</span>
                <span className="t5">{recordTop5(x)}</span>
              </div>
            ))}
          </div>
        </section>
      </aside>

      {/* ---------------- specimen stage ---------------- */}
      <section className="stage">
        <div className="stage-bar">
          <button className="btn btn-primary" onClick={doScan} disabled={busy} title="Scan the next sheet (Space)">
            {Icons.scan} {work ? "Scan next" : "Scan"} <span className="kbd">Space</span>
          </button>
          <button className="btn" onClick={doImport} disabled={busy} title={`Open an image file (${MOD}+O)`}>
            {Icons.image} Import
          </button>
          <span className="sep" />
          <button className="iconbtn" onClick={s.undo} disabled={!work?.undo.length} title={`Undo (${MOD}+Z)`}>{Icons.undo}</button>
          <button className="iconbtn" onClick={s.redo} disabled={!work?.redo.length} title={`Redo (${MOD}+Shift+Z)`}>{Icons.redo}</button>
          <span className="sep" />
          <button className="iconbtn" onClick={() => setZoomCmd({ kind: "out", nonce: Date.now() })} disabled={!work?.imageDataUrl} title="Zoom out (−)">{Icons.zoomOut}</button>
          <button className="iconbtn" onClick={() => setZoomCmd({ kind: "in", nonce: Date.now() })} disabled={!work?.imageDataUrl} title="Zoom in (+)">{Icons.zoomIn}</button>
          <button className="iconbtn" onClick={() => setZoomCmd({ kind: "fit", nonce: Date.now() })} disabled={!work?.imageDataUrl} title="Fit whole scan (F)">{Icons.fit}</button>
          <span className="grow" />
          <button className={`iconbtn${overlays.top5 ? " on" : ""}`} onClick={() => setOverlay("top5", !overlays.top5)} title="Highlight the top 5%">{Icons.star}</button>
          <button className={`iconbtn${overlays.bands ? " on" : ""}`} onClick={() => setOverlay("bands", !overlays.bands)} title="Rank lines 5 / 25 / 75 % (L)">{Icons.bands}</button>
          <button className={`iconbtn${overlays.sheet ? " on" : ""}`} onClick={() => setOverlay("sheet", !overlays.sheet)} title="Sheet outline (S)">{Icons.sheet}</button>
          <button className={`iconbtn${overlays.suspects ? " on" : ""}`} onClick={() => setOverlay("suspects", !overlays.suspects)} title="Possible misses (M)">{Icons.target}</button>
          <button className="iconbtn" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)">{Icons.keyboard}</button>
        </div>

        <div className="stage-body"
          onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
          onDrop={onDrop}>
          {rec && work?.imageDataUrl ? (
            <EditCanvas
              imageDataUrl={work.imageDataUrl}
              imageWidth={rec.imageWidth}
              imageHeight={rec.imageHeight}
              pupae={rec.pupae}
              suspects={rec.suspects ?? []}
              sheet={rec.sheet ?? null}
              top5={top5}
              overlays={overlays}
              onEdit={s.editPupae}
              onSheet={(c: Corner[]) => s.setSheetCorners(c, true)}
              onAcceptSuspect={s.acceptSuspect}
              zoomCommand={zoomCmd}
            />
          ) : (
            <div className={`dropzone${dragOver ? " drag" : ""}`} onClick={() => !busy && !rec && doImport()}>
              <div className="inner">
                <SheetGlyph />
                {rec ? (
                  <>
                    <h2>Image not available</h2>
                    <p>The counts for scan {rec.imageNumber} are saved, but its image file isn't on this computer.</p>
                  </>
                ) : (
                  <>
                    <h2>{dragOver ? "Drop to count" : "Place a sheet on the scanner glass"}</h2>
                    <p>Press <span className="kbd">Space</span> to scan. The count is saved to replicate {rep.replicateNumber} automatically. You can also drop an image file here.</p>
                  </>
                )}
              </div>
            </div>
          )}
          {rec && work?.imageDataUrl && (
            <div className="legend" aria-hidden>
              <span><i style={{ background: "var(--mark-cnn)" }} />model</span>
              <span><i style={{ background: "var(--mark-manual)" }} />added</span>
              <span><i className="ring" style={{ borderColor: "var(--mark-top5)", borderStyle: "solid" }} />top 5%</span>
              {(rec.suspects?.length ?? 0) > 0 && overlays.suspects && <span><i className="ring" style={{ borderStyle: "dashed" }} />possible miss · click to add</span>}
            </div>
          )}
          {banners.length > 0 && <div className="banners">{banners}</div>}
          {busy && (
            <div className="busy-veil"><div className="box"><span className="spinner" />{stageDetail}</div></div>
          )}
        </div>

        <div className="stage-foot">
          {rec ? (
            <>
              <span className="mono" title={rec.imagePath}>{rec.imagePath.split(/[\\/]/).pop()}</span>
              <span className="mono">{rec.imageWidth} × {rec.imageHeight}</span>
              <span className="mono" title={`DPI source: ${rec.dpiSource ?? "unknown"}`}>
                {rec.actualDpi ? `${rec.actualDpi} DPI` : "DPI unknown"}
                {rec.requestedDpi ? ` (asked ${rec.requestedDpi})` : ""}
              </span>
              {rec.inferenceScale && rec.inferenceScale !== 1 && (
                <span className="mono" title="The model was trained at a different DPI; the image was resized for counting and the coordinates mapped back.">
                  model ran at {rec.trainDpi} DPI (×{rec.inferenceScale})
                </span>
              )}
              <span className="grow" />
              <span className="mono">{rec.modelVersion ?? "saved record"}</span>
            </>
          ) : (
            <><span>Ready</span><span className="grow" /><span className="mono">{session.sessionId}</span></>
          )}
        </div>
      </section>

      {/* ---------------- readout ---------------- */}
      <aside className="readout" aria-label="This scan">
        <section className="panel-sec">
          <h3>
            {rec ? <>Scan {rec.imageNumber} · replicate {rec.replicateNumber}</> : <>Next scan</>}
            {rec && (work?.persisted ? <span className="pill good">Saved</span> : work?.mock ? <span className="pill bad">Not saved</span> : null)}
          </h3>
          <div className="count-hero">
            <div>
              <div className="cap">Pupae</div>
              <div className={`big${rec ? "" : " empty"}`} data-testid="scan-total">{rec ? rec.totalPupae : "—"}</div>
            </div>
            <div className="side">
              <div className="cap">Top 5%</div>
              <div className="t5" data-testid="scan-top5">{rec ? top5Count(rec.totalPupae) : "—"}</div>
            </div>
          </div>
          {rec && (
            <div className="edits">
              Model found <b>{rec.cnnCount ?? rec.pupae.filter((p) => p.source === "cnn").length}</b>
              {edits.added > 0 && <> · added <b>{edits.added}</b></>}
              {edits.removed > 0 && <> · removed <b>{edits.removed}</b></>}
              {(rec.suspects?.length ?? 0) > 0 && <> · <span style={{ color: "var(--mark-suspect)" }}>{rec.suspects!.length} possible misses</span></>}
            </div>
          )}
        </section>

        {rec && rec.totalPupae > 0 && (
          <section className="panel-sec">
            <h3>Distribution</h3>
            <BandBlock rec={rec} />
          </section>
        )}

        {rec && (
          <section className="panel-sec">
            <h3>Sheet {rec.sheet?.manual ? <span className="pill accent">Adjusted</span> : rec.sheet?.found ? <span className="pill">{Math.round((rec.sheet.confidence ?? 0) * 100)}% sure</span> : <span className="pill warn">Not found</span>}</h3>
            <SheetBlock rec={rec} top5={top5} />
          </section>
        )}

        <section className="panel-sec">
          <h3>{rec ? "Labels for this scan" : "Labels"}</h3>
          {(!rec || inCurrentRep) && (
            <div className="carry">{Icons.check} Kept for the next scan in replicate {rep.replicateNumber}</div>
          )}
          <MetaForm idPrefix="scan" meta={rec ? rec : draftMeta} onChange={s.updateMeta} />
        </section>

        {rec && (
          <section className="panel-sec">
            <div className="readout-actions">
              <button className="btn btn-sm" onClick={s.revertToCnn} disabled={edits.added + edits.removed === 0} title="Throw away manual edits and restore the model's dots">
                {Icons.revert} Revert to model
              </button>
              <button className="btn btn-sm btn-danger" onClick={discard} title="Remove this scan from the replicate">
                {Icons.trash} Remove scan
              </button>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

function BandBlock({ rec }: { rec: ScanRecord }) {
  const n = rec.totalPupae;
  const t5 = top5Count(n);
  const rows: { label: string; v: number; color: string }[] = [
    { label: "Rank 0–5 %", v: rec.top5PctCount, color: "var(--mark-top5)" },
    { label: "Rank 5–25 %", v: rec.rank5To25Count, color: "color-mix(in srgb, var(--mark-top5) 45%, var(--line-strong))" },
    { label: "Rank 25–75 %", v: rec.middle50Count, color: "var(--line-strong)" },
    { label: "Rank 75–100 %", v: rec.bottom25Count, color: "color-mix(in srgb, var(--accent) 45%, var(--line-strong))" },
  ];
  return (
    <>
      <div className="bandbar" aria-hidden>
        {rows.map((r) => <span key={r.label} style={{ width: `${(r.v / Math.max(1, n)) * 100}%`, background: r.color }} />)}
      </div>
      <table className="bandtable">
        <tbody>
          <tr><td><span className="sw" style={{ background: "var(--mark-top5)", borderRadius: "50%" }} />Top 5 % (by count)</td><td className="n">{t5}</td></tr>
          {rows.map((r) => (
            <tr key={r.label}><td><span className="sw" style={{ background: r.color }} />{r.label} <span className="muted">of y-range</span></td><td className="n">{r.v}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function SheetBlock({ rec, top5 }: { rec: ScanRecord; top5: Set<number> }) {
  const sh = rec.sheet;
  if (!sh?.found) return <div className="edits">Place the outline to get each pupa's height on the sheet.</div>;
  const pcts = rec.pupae.map((p) => p.sheetPct).filter((v): v is number => typeof v === "number");
  const topP = rec.pupae.filter((_, i) => top5.has(i)).map((p) => p.sheetPct).filter((v): v is number => typeof v === "number");
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const m = mean(pcts), mt = mean(topP);
  return (
    <table className="bandtable">
      <tbody>
        <tr><td>Mean sheet position</td><td className="n">{m == null ? "—" : m.toFixed(1)}</td></tr>
        <tr><td>Mean of top 5 %</td><td className="n">{mt == null ? "—" : mt.toFixed(1)}</td></tr>
        <tr><td>Length × width</td><td className="n">{sh.lengthPx ? `${Math.round(sh.lengthPx)} × ${Math.round(sh.widthPx ?? 0)} px` : "—"}</td></tr>
        <tr><td>Tilt</td><td className="n">{sh.angleDeg != null ? `${sh.angleDeg.toFixed(1)}°` : "—"}</td></tr>
        {(sh.truncatedTop || sh.truncatedBottom) && (
          <tr><td colSpan={2} style={{ color: "var(--warn)" }}>{sh.truncatedTop ? "Top" : "Bottom"} end touches the scan edge</td></tr>
        )}
        <tr><td className="muted">Detector</td><td className="n muted">{sh.manual ? "adjusted by hand" : sh.method ?? "—"}</td></tr>
      </tbody>
    </table>
  );
}

/** Starting outline when detection found nothing: a box around the pupae,
 *  or the middle of the image. */
function defaultCorners(rec: ScanRecord): Corner[] {
  const W = rec.imageWidth, H = rec.imageHeight;
  let x0 = W * 0.35, x1 = W * 0.65, y0 = H * 0.1, y1 = H * 0.9;
  if (rec.pupae.length >= 2) {
    const xs = rec.pupae.map((p) => p.x), ys = rec.pupae.map((p) => p.y);
    const padX = Math.max(30, (Math.max(...xs) - Math.min(...xs)) * 0.15);
    const padY = Math.max(30, (Math.max(...ys) - Math.min(...ys)) * 0.08);
    x0 = Math.max(0, Math.min(...xs) - padX); x1 = Math.min(W - 1, Math.max(...xs) + padX);
    y0 = Math.max(0, Math.min(...ys) - padY); y1 = Math.min(H - 1, Math.max(...ys) + padY);
  }
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
