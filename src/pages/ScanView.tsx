import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icons } from "../components/icons";
import { ScanImage } from "../components/ScanImage";
import { EditCanvas } from "../components/EditCanvas";
import { currentReplicate, useSessionStore, isoNow } from "../store/sessionStore";
import { useSettings } from "../store/settingsStore";
import { scanNow, loadScanFromPath, listDemoScans, type ScanHandle } from "../adapters/scannerAdapter";
import { runDetection, CnnUnavailableError, isMockModel } from "../adapters/cnnAdapter";
import { recordTop5, sheetNeedsCheck, top5Count } from "../lib/bands";
import type { TabName } from "../components/TopNav";
import type { Corner, Pupa, Suspect } from "../types";
import type { ToastTone } from "../App";

interface Props {
  onNavigate: (tab: TabName) => void;
  onToast: (msg: string, tone?: ToastTone) => void;
}

const OTHER = "__other__";

/** Read-only path fields: show the end (file name), not the start of the path. */
function scrollToEnd(el: HTMLInputElement | null) {
  if (el) requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth; });
}

function cleanError(err: unknown): string {
  const msg = err instanceof CnnUnavailableError || err instanceof Error ? err.message : String(err);
  const m = msg
    .replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
    .replace(/\b(Error|FileNotFoundError|ValueError|RuntimeError): /g, "");
  if (/could not read image/i.test(m)) return "the file could not be read as an image (is it a PNG or JPG scan?)";
  if (/no scanner found/i.test(m)) return "no scanner found. Check the USB cable and that the scanner is switched on.";
  if (/icscan scan timed out|timed out after/i.test(m)) return "the scanner did not respond in time. Unplug it, plug it back in and try again.";
  if (/^open: /i.test(m) || /ImageCaptureCore Code=/i.test(m)) return `the scanner could not be opened (is another app such as Image Capture using it?) — ${m}`;
  return m;
}

const IMAGE_EXT = /\.(png|jpe?g|tiff?)$/i;

export function ScanView({ onNavigate, onToast }: Props) {
  const session = useSessionStore((s) => s.session);
  const currentReplicateId = useSessionStore((s) => s.currentReplicateId);
  const pendingScan = useSessionStore((s) => s.pendingScan);
  const draftMeta = useSessionStore((s) => s.draftMeta);
  const beginPendingScan = useSessionStore((s) => s.beginPendingScan);
  const setDetection = useSessionStore((s) => s.setDetection);
  const setPendingPupae = useSessionStore((s) => s.setPendingPupae);
  const setPendingSheet = useSessionStore((s) => s.setPendingSheet);
  const updateMeta = useSessionStore((s) => s.updateMeta);
  const commitPendingScan = useSessionStore((s) => s.commitPendingScan);
  const startNewReplicate = useSessionStore((s) => s.startNewReplicate);
  const genotypes = useSettings((s) => s.genotypes);
  const scanDpi = useSettings((s) => s.scanner.dpi);
  const setScanner = useSettings((s) => s.setScanner);

  const [processing, setProcessing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [zoomCommand, setZoomCommand] = useState<
    { kind: "in" | "out" | "fit"; nonce: number } | null
  >(null);
  const [dragActive, setDragActive] = useState(false);
  const [otherGenotype, setOtherGenotype] = useState(false);
  // Collapsible sidebars — persisted to localStorage so the layout
  // sticks across reloads. Default to expanded for first-time users.
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("scanview.leftCollapsed") === "1"; } catch { return false; }
  });
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("scanview.rightCollapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("scanview.leftCollapsed", leftCollapsed ? "1" : "0"); } catch {}
  }, [leftCollapsed]);
  useEffect(() => {
    try { localStorage.setItem("scanview.rightCollapsed", rightCollapsed ? "1" : "0"); } catch {}
  }, [rightCollapsed]);

  const busy = processing || scanning;
  const state: "empty" | "processing" | "detected" =
    !pendingScan ? "empty" : pendingScan.detection ? "detected" : "processing";
  const det = pendingScan?.detection;
  const originalCnn = pendingScan?.cnnPupae ?? null;
  const mock = isMockModel(det?.modelVersion);
  // A failed scanner run doesn't invalidate the counted scan still on screen;
  // only a failed detection does.
  const detectionFailed = !!detectionError && !detectionError.startsWith("Scan failed");
  const detectionFailedRef = useRef(false);
  detectionFailedRef.current = detectionFailed;
  const canSave = state === "detected" && !mock && !detectionFailed && !busy;

  const round = currentReplicate({ session, currentReplicateId });
  const allScans = session.replicates.flatMap((r) => r.scans);
  const totalScansInSession = allScans.length;
  const totalPupaeInSession = allScans.reduce((a, s) => a + s.totalPupae, 0);
  const top5InSession = allScans.reduce((a, s) => a + recordTop5(s), 0);
  const repTotal = round.scans.reduce((a, s) => a + s.totalPupae, 0);
  const repTop5 = round.scans.reduce((a, s) => a + recordTop5(s), 0);
  const pendingCount = det?.counts.total ?? 0;
  const runningTotalInRound = repTotal + pendingCount;
  const runningTop5InRound = repTop5 + top5Count(pendingCount);

  // ---- save -------------------------------------------------------------------------
  const save = useCallback((reason?: string) => {
    const st = useSessionStore.getState();
    const d = st.pendingScan?.detection;
    if (!d || isMockModel(d.modelVersion)) return null;
    const record = st.commitPendingScan();
    if (record) {
      onToast(reason
        ? `${reason}: saved scan ${record.imageNumber} (${record.totalPupae} pupae) to replicate ${record.replicateNumber}`
        : `Saved scan ${record.imageNumber} — ${record.totalPupae} pupae · replicate ${record.replicateNumber}`);
    }
    return record;
  }, [onToast]);

  // ---- detect -----------------------------------------------------------------------
  const loadAndDetect = useCallback(async (handle: ScanHandle) => {
    // Never drop an unsaved, finished scan when the next one comes in.
    const st = useSessionStore.getState();
    // (Read through a ref: this callback can run from a closure made before a
    // scanner error was cleared, which used to drop the previous scan.)
    if (st.pendingScan?.detection && !isMockModel(st.pendingScan.detection.modelVersion) && !detectionFailedRef.current) {
      save("Before the next scan");
    }
    beginPendingScan(handle.path, handle.dataUrl, {
      requestedDpi: handle.requestedDpi, actualDpi: handle.actualDpi, dpiSource: handle.dpiSource,
    });
    setOtherGenotype(false);
    setProcessing(true);
    setDetectionError(null);
    try {
      const detection = await runDetection(handle.path, {
        dpi: handle.actualDpi ?? null, width: handle.width, height: handle.height,
        analysisPath: handle.analysis?.path ?? null,
        analysisDpi: handle.analysis?.actualDpi ?? null,
      });
      if (detection.analysis?.warning) onToast(`Two-pass scan: ${detection.analysis.warning}`, "warn");
      setDetection(detection);
      if (handle.warnings?.length) onToast(`Scanner: ${handle.warnings[0]}`, "warn");
    } catch (err) {
      const msg = cleanError(err);
      console.error("[ScanView] detection failed:", err);
      setDetectionError(msg);
      onToast(`Detection failed — ${msg}`, "bad");
    } finally {
      setProcessing(false);
    }
  }, [beginPendingScan, setDetection, onToast, save]);

  const handleNewScan = useCallback(async () => {
    if (busy) return;
    setScanning(true);
    setDetectionError(null);
    try {
      const handle = await scanNow();
      setScanning(false);
      if (handle) await loadAndDetect(handle);
    } catch (err) {
      const msg = cleanError(err);
      setDetectionError(`Scan failed: ${msg}`);
      onToast(`Scan failed — ${msg}`, "bad");
    } finally {
      setScanning(false);
    }
  }, [busy, loadAndDetect, onToast]);

  const openPath = useCallback(async (path: string) => {
    try {
      const handle = await loadScanFromPath(path);
      if (handle) await loadAndDetect(handle);
    } catch (err) {
      onToast(`Could not open ${path.split(/[\\/]/).pop()} — ${cleanError(err)}`, "bad");
    }
  }, [loadAndDetect, onToast]);

  const handleLoadFromFile = useCallback(async () => {
    if (!window.pupa || busy) return;
    const path = await window.pupa.dialog.openImage();
    if (!path) return;
    await openPath(path);
  }, [busy, openPath]);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (!file || busy) return;
    if (!IMAGE_EXT.test(file.name)) {
      onToast(`${file.name} is not a scan image — drop a PNG or JPG`, "warn");
      return;
    }
    const path = window.pupa?.file.pathForFile(file) || (file as File & { path?: string }).path;
    if (path) {
      await openPath(path);
      return;
    }
    const dataUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => loadAndDetect({ path: file.name, dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    img.src = dataUrl;
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      if (!dragActive) setDragActive(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  };

  const handleLoadDemo = async () => {
    const demos = await listDemoScans();
    if (demos.length === 0) {
      onToast("No demo scans found (set PUPA_DEMO_DIR or add PNGs to Downloads/pupate_batch)", "warn");
      return;
    }
    const pick = demos[Math.floor(Math.random() * demos.length)];
    await openPath(pick);
  };

  const handleProcess = async () => {
    if (!pendingScan) return handleNewScan();
    setProcessing(true);
    setDetectionError(null);
    try {
      const d = await runDetection(pendingScan.imagePath, {
        dpi: pendingScan.actualDpi,
        width: pendingScan.detection?.imageWidth,
        height: pendingScan.detection?.imageHeight,
        analysisPath: pendingScan.detection?.analysis?.path ?? null,
        analysisDpi: pendingScan.detection?.analysis?.dpi ?? null,
      });
      setDetection(d);
    } catch (err) {
      const msg = cleanError(err);
      console.error("[ScanView] re-process failed:", err);
      setDetectionError(msg);
      onToast(`Detection failed — ${msg}`, "bad");
    } finally {
      setProcessing(false);
    }
  };

  const handleRevert = () => {
    if (!originalCnn) return;
    setPendingPupae(originalCnn);
    onToast("Reverted to CNN output");
  };

  const handleSave = () => {
    if (mock) {
      onToast("Refused to save — current detection is from the mock backend", "bad");
      return;
    }
    save();
  };

  const acceptSuspect = (s: Suspect) => {
    const d = useSessionStore.getState().pendingScan?.detection;
    if (!d) return;
    setPendingPupae([...d.pupae, { index: d.pupae.length + 1, x: s.x, y: s.y, rankPct: 0, band: "25-75%", source: "manual" }]);
  };

  // ---- keyboard: Space = new scan, ⌘S = save, ⌘O = open file ------------------------------
  const keyRef = useRef({ handleNewScan, handleSave, handleLoadFromFile });
  keyRef.current = { handleNewScan, handleSave, handleLoadFromFile };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "s") { e.preventDefault(); keyRef.current.handleSave(); return; }
      if (meta && e.key.toLowerCase() === "o") { e.preventDefault(); keyRef.current.handleLoadFromFile(); return; }
      if (!typing && !meta && e.code === "Space") { e.preventDefault(); keyRef.current.handleNewScan(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Screenshot-tour hooks (electron/tour.js); harmless otherwise.
  useEffect(() => {
    window.__pupaDebug = {
      load: async (p: string, dpi?: { requestedDpi: number; actualDpi: number; analysisPath?: string } | null) => {
        const h = await loadScanFromPath(p);
        const analysis = dpi?.analysisPath ? { path: dpi.analysisPath, width: 0, height: 0, actualDpi: 150 } : null;
        if (h) await loadAndDetect({ ...h, ...(dpi ?? {}), analysis, dpiSource: dpi ? "simulated scanner" : undefined });
      },
      nudgeSheet: () => {
        const p = useSessionStore.getState().pendingScan;
        const c = p?.sheet?.corners;
        if (!c || c.length !== 4) return null;
        const before = p!.detection!.pupae.slice(0, 3).map((q) => q.sheetPct);
        const moved: Corner[] = [[c[0][0] + 40, c[0][1] + 60], [c[1][0] - 20, c[1][1] + 60], c[2], c[3]];
        useSessionStore.getState().setPendingSheet(moved);
        const after = useSessionStore.getState().pendingScan!.detection!.pupae.slice(0, 3).map((q) => q.sheetPct);
        return { before, after, manual: useSessionStore.getState().pendingScan!.sheet!.manual };
      },
      save: () => save(),
    };
  }, [loadAndDetect, save]);

  // ---- derived -----------------------------------------------------------------------
  const currentPupae: Pupa[] = det?.pupae ?? [];
  const manualAdded = currentPupae.filter((p) => p.source === "manual").length;
  const cnnOriginalCount = originalCnn?.filter((p) => p.source === "cnn").length ?? pendingScan?.cnnCount ?? 0;
  const cnnRemaining = currentPupae.filter((p) => p.source === "cnn").length;
  const removed = Math.max(0, cnnOriginalCount - cnnRemaining);
  const countForThisScan = currentPupae.length;
  const suspects = useMemo(
    () => (det?.suspects ?? []).filter((s) => !currentPupae.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 4)),
    [det?.suspects, currentPupae],
  );

  // Count-based banding: top 5 % by COUNT (rounded, at least 1), bottom 5 %
  // likewise, the rest in the middle. 100 pupae → 5 / 90 / 5; 23 → 1 / 21 / 1.
  const top5N = top5Count(countForThisScan);
  const bottom5N = top5Count(countForThisScan);
  const middleN = Math.max(0, countForThisScan - top5N - bottom5N);

  const sheet = pendingScan?.sheet ?? null;
  const sheetLow = sheetNeedsCheck(sheet);
  const sheetPcts = currentPupae.map((p) => p.sheetPct).filter((v): v is number => typeof v === "number");
  const meanSheet = sheetPcts.length ? sheetPcts.reduce((a, b) => a + b, 0) / sheetPcts.length : null;
  const dpiMismatch = !!pendingScan?.requestedDpi && !!pendingScan?.actualDpi
    && Math.abs(pendingScan.requestedDpi - pendingScan.actualDpi) > 2;

  const meta = pendingScan?.metadata ?? draftMeta;
  const genotypeInList = genotypes.includes(meta.genotype);
  const showOther = otherGenotype || (!!meta.genotype && !genotypeInList);

  return (
    <div
      className="s1-body"
      style={{
        gridTemplateColumns:
          `${leftCollapsed ? "36px" : "clamp(232px, 17vw, 248px)"} minmax(0, 1fr) ${rightCollapsed ? "36px" : "clamp(380px, 30vw, 440px)"}`,
      }}
    >
      <aside className={`sidebar${leftCollapsed ? " collapsed" : ""}`}>
        <button
          className="sidebar-toggle sidebar-toggle-left"
          onClick={() => setLeftCollapsed((v) => !v)}
          title={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {leftCollapsed ? "›" : "‹"}
        </button>
        {leftCollapsed ? null : (<>
        <div className="side-section">
          <div className="label">Session</div>
          <dl className="session-card">
            <dt>Operator</dt><dd>{session.operator || "—"}</dd>
            <dt>Experiment</dt><dd>{session.experiment || "—"}</dd>
            <dt>Start</dt><dd className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{session.startedAt.slice(0, 10) || "—"}</dd>
            <dt>Replicate</dt><dd>Replicate {round?.replicateNumber ?? 1}</dd>
          </dl>
        </div>
        <div className="side-section">
          <div className="label">Replicate {round?.replicateNumber ?? 1}</div>
          <div className="session-stats">
            <div className="mini-stat"><div className="n">{repTotal.toLocaleString()}</div><div className="l">Pupae</div></div>
            <div className="mini-stat"><div className="n accent">{repTop5.toLocaleString()}</div><div className="l">Top 5%</div></div>
          </div>
        </div>
        <div className="side-section">
          <div className="label">Session · {totalScansInSession} scan{totalScansInSession === 1 ? "" : "s"}</div>
          <div className="session-stats">
            <div className="mini-stat"><div className="n">{totalPupaeInSession.toLocaleString()}</div><div className="l">Pupae</div></div>
            <div className="mini-stat"><div className="n accent">{top5InSession.toLocaleString()}</div><div className="l">Top 5%</div></div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" style={{ justifyContent: "center" }} disabled={busy} onClick={() => {
          if (!pendingScan && round.scans.length === 0) {
            onToast(`Replicate ${round.replicateNumber} has no scans yet — keep scanning into it`, "warn");
            return;
          }
          if (pendingScan?.detection && !mock && !detectionFailed) save("Before the new replicate");
          startNewReplicate();
          onToast("Started a new replicate — genotype, comments and filename reset");
        }}>
          {Icons.plus} Start new replicate
        </button>
        {(window.pupa as any)?.app?.flags?.demo && (
          <button className="btn btn-ghost" style={{ justifyContent: "center", marginTop: 4 }} onClick={handleLoadDemo} disabled={busy}>
            Load demo scan
          </button>
        )}
        </>)}
      </aside>

      <section className="middle">
        <div
          className="card scan-card"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={dragActive ? { outline: "2px dashed var(--accent)", outlineOffset: -2 } : undefined}
        >
          <div className="card-head">
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div className="card-title">Current scan</div>
              <span className="card-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pendingScan ? pendingScan.imagePath.split(/[\\/]/).pop() : "—"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
              {detectionError && !busy && (
                <span className="pill bad" title={detectionError}>
                  <span className="dot" />
                  {detectionError.startsWith("Scan failed") ? "Scan failed" : "Detection failed"}
                </span>
              )}
              {state === "detected" && !busy && !detectionError && !mock && (
                <span className="pill good"><span className="dot" />Detection complete</span>
              )}
              {state === "detected" && !busy && mock && (
                <span className="pill warn" title="Mock mode — real Python worker unavailable. Saving is disabled.">
                  <span className="dot" />MOCK — not real data
                </span>
              )}
              {busy && (
                <span className="pill accent"><span className="dot" />{scanning ? "Scanning…" : "Processing…"}</span>
              )}
              {state === "empty" && !busy && !detectionError && <span className="pill">No scan loaded</span>}
              {(manualAdded > 0 || removed > 0) && (
                <span className="pill accent">
                  <span className="dot" />edited
                  {manualAdded > 0 ? ` +${manualAdded}` : ""}
                  {removed > 0 ? ` −${removed}` : ""}
                </span>
              )}
            </div>
          </div>

          {state === "detected" && (dpiMismatch || sheetLow || (sheet && !sheet.found) || !sheet) && (
            <div className="notice-stack">
              {dpiMismatch && (
                <div className="notice warn">
                  <b>Scanner delivered {pendingScan!.actualDpi} DPI, not the {pendingScan!.requestedDpi} DPI requested.</b>
                  <span>Counts are still valid (the image is resized for the model); check the scanner driver if you need full resolution.</span>
                </div>
              )}
              {sheetLow && (
                <div className="notice warn">
                  <b>Check the sheet outline:</b>
                  <span>
                    the detector is only {Math.round((sheet!.confidence ?? 0) * 100)} % sure
                    {sheet!.truncatedTop ? " and the top end is cut off by the scan edge"
                      : sheet!.truncatedBottom ? " and the bottom end is cut off by the scan edge" : ""} — drag the corner squares onto the sheet edges.
                  </span>
                  <button className="btn" onClick={() => setPendingSheet(sheet!.corners, true)}>Looks right</button>
                </div>
              )}
              {(!sheet || !sheet.found) && (
                <div className="notice warn">
                  <b>Sheet outline not found:</b>
                  <span>sheet position can't be computed until you place it.</span>
                  <button className="btn" onClick={() => setPendingSheet(defaultCorners(det!.imageWidth, det!.imageHeight, currentPupae))}>Place outline</button>
                </div>
              )}
            </div>
          )}

          {/* Main canvas region */}
          {detectionError && !det && !busy ? (
            <div className="drop-zone" onClick={handleLoadFromFile} style={{ cursor: "pointer" }}>
              <div className="inner" style={{ maxWidth: 460, padding: "0 16px" }}>
                <div className="primary" style={{ color: "var(--bad)" }}>
                  {detectionError.startsWith("Scan failed") ? "The scan did not go through" : "This image could not be counted"}
                </div>
                <div className="secondary" style={{ color: "var(--muted)", wordBreak: "break-word" }}>
                  {detectionError.replace(/^Scan failed: /, "")}
                </div>
                <div className="secondary">
                  Click to load another file, drag one here, or press <span className="kbd">Space</span> to scan again
                </div>
              </div>
            </div>
          ) : state === "empty" ? (
            <div
              className="drop-zone"
              onClick={handleLoadFromFile}
              style={{ cursor: "pointer", background: dragActive ? "var(--accent-soft)" : undefined }}
            >
              <div className="inner">
                {Icons.upload}
                <div className="primary">
                  {busy ? "Scanning…" : dragActive ? "Drop file to analyze" : "Drag a scan here, or click to browse"}
                </div>
                <div className="secondary">
                  {busy
                    ? scanDpi > 150
                      ? `Scanning at ${scanDpi} dpi (shrunk to 150 dpi for counting) — keep the lid closed`
                      : "Keep the lid closed until the scan finishes"
                    : <>Accepts .png / .jpg — or press <span className="kbd">Space</span> / <b>New scan</b> to use the scanner</>}
                </div>
              </div>
            </div>
          ) : pendingScan?.imageDataUrl && det ? (
            <div className="scan-img" style={{ padding: 0, margin: 12, display: "flex", flexDirection: "column" }}>
              <EditCanvas
                imageDataUrl={pendingScan.imageDataUrl}
                imageWidth={det.imageWidth}
                imageHeight={det.imageHeight}
                pupae={currentPupae}
                onChange={(next) => setPendingPupae(next)}
                zoomCommand={zoomCommand}
                showRankLines={true}
                sheet={sheet}
                onSheetChange={(c) => setPendingSheet(c)}
                suspects={suspects}
                onAcceptSuspect={acceptSuspect}
              />
            </div>
          ) : pendingScan?.imageDataUrl ? (
            <div className="scan-img" style={{ display: "grid", placeItems: "center" }}>
              <img src={pendingScan.imageDataUrl} alt="" draggable={false}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: 0.5 }} />
              <span className="pill accent" style={{ position: "absolute" }}><span className="dot" />Counting pupae…</span>
            </div>
          ) : (
            <div className="scan-img">
              <ScanImage variant={state} />
            </div>
          )}

          <div className="status-strip">
            <span>{countForThisScan} pupae{state === "detected" && manualAdded + removed > 0 ? ` (CNN ${cnnOriginalCount}${manualAdded > 0 ? ` +${manualAdded}` : ""}${removed > 0 ? ` −${removed}` : ""})` : " detected"}</span>
            <span className="sep">·</span>
            <span>{det?.durationMs ? `${(det.durationMs / 1000).toFixed(1)} s` : "—"}</span>
            <span className="sep">·</span>
            <span>{det ? `${det.imageWidth} × ${det.imageHeight}` : "—"}</span>
            <span className="sep">·</span>
            <span title={pendingScan?.dpiSource ? `DPI from ${pendingScan.dpiSource}` : undefined}>
              {pendingScan?.actualDpi ? `${pendingScan.actualDpi} dpi` : "— dpi"}
              {det?.analysis
                ? ` (counted on a native ${det.analysis.dpi ?? 150}-dpi pass)`
                : det?.inferenceScale && det.inferenceScale !== 1 ? ` (counted at ${det.trainDpi} dpi)` : ""}
            </span>
            <span className="sep">·</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>model {det?.modelVersion ?? "—"}</span>
          </div>
        </div>

        {/* Toolbar */}
        <div className="middle-actions">
          <button className="btn" onClick={handleNewScan} disabled={busy} title="Trigger the connected scanner (Space)">
            {Icons.upload} New scan
          </button>
          <select className="select" value={scanDpi} disabled={busy}
            style={{ width: "auto", minWidth: 0, flex: "none", padding: "4px 26px 4px 10px" }}
            title="Scan resolution. Detection always runs at the model's 150 DPI; higher DPI only makes the saved image sharper (for labelling / future models)."
            onChange={(e) => setScanner({ dpi: parseInt(e.target.value, 10) })}>
            {[150, 300, 600].map((n) => (
              <option key={n} value={n}>{n} dpi{n === 150 ? " · model" : ""}</option>
            ))}
          </select>
          <button className="btn" onClick={handleLoadFromFile} disabled={busy} title="Pick an existing PNG/JPG from disk (⌘O)">
            {Icons.folder} Load file…
          </button>
          <button className="btn btn-primary" onClick={handleProcess} disabled={!pendingScan || busy} title="Run detection again on this image">
            {processing ? "Processing…" : <>Process {Icons.arrowRight}</>}
          </button>
          <div className="tool-group" style={{ marginLeft: 4 }}>
            <button className="iconbtn" title="Zoom out (−)" disabled={state !== "detected"}
              onClick={() => setZoomCommand({ kind: "out", nonce: Date.now() })}>
              {Icons.zoomOut}
            </button>
            <button className="iconbtn" title="Zoom in (+)" disabled={state !== "detected"}
              onClick={() => setZoomCommand({ kind: "in", nonce: Date.now() })}>
              {Icons.zoomIn}
            </button>
            <button className="iconbtn" title="Fit (F)" disabled={state !== "detected"}
              onClick={() => setZoomCommand({ kind: "fit", nonce: Date.now() })}>
              {Icons.fit}
            </button>
          </div>
          <button className="btn"
            onClick={handleRevert}
            disabled={!originalCnn || manualAdded + removed === 0}
            title="Revert manual edits — restore CNN output">
            {Icons.undo} Revert
          </button>
          <div className="spacer" />
          <span className="hint mono toolbar-hint">Space scan · ⌘S save · ⌘Z undo · F fit</span>
        </div>
      </section>

      <aside className={`right${rightCollapsed ? " collapsed" : ""}`}>
        <button
          className="sidebar-toggle sidebar-toggle-right"
          onClick={() => setRightCollapsed((v) => !v)}
          title={rightCollapsed ? "Expand panel" : "Collapse panel"}
          aria-label={rightCollapsed ? "Expand panel" : "Collapse panel"}
        >
          {rightCollapsed ? "‹" : "›"}
        </button>
        {rightCollapsed ? null : (<>
        <div className="card form-card">
          <div className="card-head">
            <div className="card-title">Image information</div>
            <span className="card-sub">{pendingScan ? `Scan ${pendingScan.imageNumber}` : "Next scan"} · replicate {round?.replicateNumber ?? 1}</span>
          </div>
          <div className="form-grid">
            <div className="field"><label htmlFor="f-operator">Your name</label>
              <input id="f-operator" className="input" value={meta.operator}
                onChange={(e) => updateMeta({ operator: e.target.value })} placeholder="Operator" /></div>
            <div className="field"><label>Date & time</label>
              <input className="input mono" readOnly value={isoNow().slice(0, 16)} /></div>
            <div className="field"><label>File path</label>
              <input className="input mono" readOnly title={pendingScan?.imagePath} ref={(el) => scrollToEnd(el)}
                value={pendingScan?.imagePath ?? "—"}
                style={{ fontSize: 11.5 }} /></div>
            <div className="field"><label htmlFor="f-experiment">Experiment</label>
              <input id="f-experiment" className="input" value={meta.experiment}
                onChange={(e) => updateMeta({ experiment: e.target.value })} /></div>
            <div className="field"><label>Image #</label>
              <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 8, alignItems: "center" }}>
                <input className="input mono" value={pendingScan?.imageNumber ?? (round.scans.length ? Math.max(...round.scans.map((s) => s.imageNumber)) + 1 : 1)} readOnly style={{ textAlign: "center" }} />
                <span className="hint">Auto-increments after save</span>
              </div>
            </div>
            <div className="field"><label htmlFor="f-file">Info filename</label>
              <input id="f-file" className="input mono" value={meta.infoFilename}
                onChange={(e) => updateMeta({ infoFilename: e.target.value })} /></div>
            <div className="field"><label htmlFor="f-genotype">Genotype</label>
              <select id="f-genotype" className="select"
                value={showOther ? OTHER : meta.genotype}
                onChange={(e) => {
                  if (e.target.value === OTHER) { setOtherGenotype(true); updateMeta({ genotype: "" }); }
                  else { setOtherGenotype(false); updateMeta({ genotype: e.target.value }); }
                }}>
                {!meta.genotype && !showOther && <option value="">Choose…</option>}
                {genotypes.map((g) => <option key={g} value={g}>{g}</option>)}
                <option value={OTHER}>Other…</option>
              </select></div>
            {showOther && (
              <div className="field"><label htmlFor="f-genotype-other">Other genotype</label>
                <input id="f-genotype-other" className="input" autoFocus value={meta.genotype} placeholder="Type a genotype"
                  onChange={(e) => updateMeta({ genotype: e.target.value })} /></div>
            )}
            <div className="field"><label htmlFor="f-comments">Comments</label>
              <textarea id="f-comments" className="textarea" placeholder="Optional notes…"
                value={meta.comments}
                onChange={(e) => updateMeta({ comments: e.target.value })} /></div>
            <div className="field"><span /><span className="hint">These labels carry over to the next scan in this replicate.</span></div>
          </div>
        </div>

        <div className="card stats-card">
          <div className="card-head"><div className="card-title">Stats for this scan</div></div>
          <div className="stats-rows">
            <div className="stat-row">
              <div className="label-col">
                <span className="l">Total pupae</span>
                <span className="s">
                  {manualAdded + removed > 0 ? `CNN ${cnnOriginalCount}, after edits` : "Detected on this image"}
                  {suspects.length > 0 ? ` · ${suspects.length} possible misses (dashed rings)` : ""}
                </span>
              </div>
              <div className="n">{state === "detected" ? countForThisScan : "—"}</div>
            </div>
            <div className="stat-row">
              <div className="label-col">
                <span className="l">Top 5%</span>
                <span className="s">Top {top5N} pupae by rank position (above the RANK 5% line)</span>
              </div>
              <div className="n accent">{state === "detected" ? top5N : "—"}</div>
            </div>
            <div className="stat-row">
              <div className="label-col">
                <span className="l">Middle 90%</span>
                <span className="s">Remaining pupae between top &amp; bottom bands</span>
              </div>
              <div className="n">{state === "detected" ? middleN : "—"}</div>
            </div>
            <div className="stat-row">
              <div className="label-col">
                <span className="l">Bottom 5%</span>
                <span className="s">Bottom {bottom5N} pupae by rank position</span>
              </div>
              <div className="n accent">{state === "detected" ? bottom5N : "—"}</div>
            </div>
            <div className="stat-row">
              <div className="label-col">
                <span className="l">Sheet position</span>
                <span className="s">
                  {!sheet ? "Mean over pupae · 0 = sheet bottom, 100 = top"
                    : !sheet.found ? "Outline not found"
                    : sheet.manual ? "Outline adjusted by hand"
                    : `Outline ${Math.round((sheet.confidence ?? 0) * 100)} % sure${sheet.truncatedTop ? " · top end extrapolated" : sheet.truncatedBottom ? " · bottom end extrapolated" : ""} · drag corners to adjust`}
                  {sheet?.manual && <> · <button className="link-btn" onClick={() => setPendingSheet(null)}>reset</button></>}
                </span>
              </div>
              <div className="n">{meanSheet == null ? "—" : meanSheet.toFixed(1)}</div>
            </div>
            <div className="stat-row">
              <div className="label-col">
                <span className="l">Running total</span>
                <span className="s">Replicate {round?.replicateNumber ?? 1}, all scans{pendingCount ? " incl. this one" : ""}</span>
              </div>
              <div className="n">{runningTotalInRound.toLocaleString()}</div>
            </div>
            <div className="stat-row">
              <div className="label-col">
                <span className="l">Top 5% running total</span>
                <span className="s">Replicate {round?.replicateNumber ?? 1} · session {(top5InSession + top5Count(pendingCount)).toLocaleString()}</span>
              </div>
              <div className="n accent">{runningTop5InRound.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <button className="btn btn-primary"
          onClick={handleSave}
          disabled={!canSave}
          title={
            mock
              ? "Save disabled — current detection is from the mock backend. Fix the Python worker in Settings → Detection model."
              : detectionFailed
              ? `Save disabled — ${detectionError}`
              : state !== "detected"
              ? "Load and process a scan first."
              : "Write this scan + its per-pupa rows to the session (⌘S)."
          }
          style={{ justifyContent: "center", padding: "10px 14px", fontSize: 13, flex: "none" }}>
          {Icons.check} Save to database
        </button>
        </>)}
      </aside>
    </div>
  );
}

/** Starting outline when detection found none: a box around the pupae. */
function defaultCorners(W: number, H: number, pupae: Pupa[]): Corner[] {
  let x0 = W * 0.3, x1 = W * 0.7, y0 = H * 0.1, y1 = H * 0.9;
  if (pupae.length >= 2) {
    const xs = pupae.map((p) => p.x), ys = pupae.map((p) => p.y);
    const pad = 30 * Math.max(1, W / 1240); // 30 px at 150 dpi, same physical margin at 300 / 600
    x0 = Math.max(0, Math.min(...xs) - pad); x1 = Math.min(W - 1, Math.max(...xs) + pad);
    y0 = Math.max(0, Math.min(...ys) - pad); y1 = Math.min(H - 1, Math.max(...ys) + pad);
  }
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
