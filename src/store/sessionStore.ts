import { create } from "zustand";
import type {
  Corner, DetectionResult, Pupa, Replicate, ScanMeta, ScanRecord, Session, SheetInfo,
} from "../types";
import { bandCounts, recomputeRanks, top5Count, withSheetPct } from "../lib/bands";
import { normalizeSession } from "../lib/sessionSchema";
import { startingGenotype, useSettings } from "./settingsStore";

// sv-SE locale yields "YYYY-MM-DD HH:MM:SS"; pinned to LA wall-clock so
// log timestamps stay readable for the lab even when scans happen on a
// laptop set to a different timezone.
const LA_DT_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Los_Angeles",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});
export function isoNow(): string {
  return LA_DT_FMT.format(new Date()).replace(",", "");
}

const DARK_KEY = "pupa.darkMode.v1";
function readDark(): boolean {
  try { return localStorage.getItem(DARK_KEY) === "1"; } catch { return false; }
}

/** Metadata a fresh replicate starts with. Operator and experiment are
 *  session-wide; genotype / comments / info filename reset. */
export function defaultMeta(session: Session, replicateNumber: number): ScanMeta {
  return {
    operator: session.operator || useSettings.getState().defaultOperator || "",
    experiment: session.experiment || "",
    genotype: startingGenotype(),
    comments: "",
    infoFilename: `replicate${replicateNumber}.asc`,
  };
}

function metaOf(r: ScanMeta): ScanMeta {
  return {
    operator: r.operator ?? "", experiment: r.experiment ?? "", genotype: r.genotype ?? "",
    comments: r.comments ?? "", infoFilename: r.infoFilename ?? "",
  };
}

/** What the next scan of `rep` starts with: whatever the replicate used
 *  last (kept in `rep.meta`, else the last scan), otherwise the defaults. */
function carriedMeta(session: Session, rep: Replicate | undefined): ScanMeta {
  if (!rep) return defaultMeta(session, 1);
  if (rep.meta) return metaOf(rep.meta);
  const last = rep.scans[rep.scans.length - 1];
  return last ? metaOf(last) : defaultMeta(session, rep.replicateNumber);
}

interface PendingScan {
  imagePath: string;
  imageDataUrl: string | null;
  imageNumber: number;
  /** The replicate this scan was STARTED in. Commit always targets it,
   *  even if the user starts a new replicate mid-edit. */
  replicateId: string;
  detection: DetectionResult | null;
  metadata: ScanMeta;
  sheet: SheetInfo | null;
  requestedDpi: number | null;
  actualDpi: number | null;
  dpiSource: string | null;
  /** Dots the model found before any manual edit. */
  cnnCount: number;
  /** The model's own result, kept so "Revert" still works after a tab switch. */
  cnnPupae: Pupa[] | null;
}

export interface ScanDpiInfo {
  requestedDpi?: number | null;
  actualDpi?: number | null;
  dpiSource?: string | null;
}

function emptySession(): Session {
  const now = isoNow();
  return {
    sessionId: "", operator: "", experiment: "", startedAt: now,
    replicates: [{ replicateId: "r1", replicateNumber: 1, startedAt: now, scans: [] }],
  };
}

interface SessionState {
  session: Session;
  currentReplicateId: string;
  draftMeta: ScanMeta;
  pendingScan: PendingScan | null;
  darkMode: boolean;

  setOperator: (name: string) => void;
  setExperiment: (name: string) => void;
  toggleDark: () => void;
  startNewReplicate: () => void;
  loadSession: (raw: unknown) => boolean;

  beginPendingScan: (imagePath: string, imageDataUrl: string | null, dpi?: ScanDpiInfo) => void;
  setDetection: (d: DetectionResult) => void;
  setPendingPupae: (pupae: Pupa[]) => void;
  setPendingSheet: (corners: Corner[] | null, confirmOnly?: boolean) => void;
  updateMeta: (m: Partial<ScanMeta>) => void;
  commitPendingScan: () => ScanRecord | null;
  clearPendingScan: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: emptySession(),
  currentReplicateId: "r1",
  draftMeta: defaultMeta(emptySession(), 1),
  pendingScan: null,
  darkMode: readDark(),

  setOperator: (name) => set((s) => ({
    session: { ...s.session, operator: name },
    draftMeta: { ...s.draftMeta, operator: name },
    pendingScan: s.pendingScan ? { ...s.pendingScan, metadata: { ...s.pendingScan.metadata, operator: name } } : null,
  })),
  setExperiment: (name) => set((s) => ({
    session: { ...s.session, experiment: name },
    draftMeta: { ...s.draftMeta, experiment: name },
    pendingScan: s.pendingScan ? { ...s.pendingScan, metadata: { ...s.pendingScan.metadata, experiment: name } } : null,
  })),
  toggleDark: () => set((s) => {
    try { localStorage.setItem(DARK_KEY, s.darkMode ? "0" : "1"); } catch { /* ignore */ }
    return { darkMode: !s.darkMode };
  }),

  loadSession: (raw) => {
    const data = normalizeSession(raw);
    if (!data) return false;
    // Latest replicate; clears any in-flight pending scan so it can't land
    // on the wrong session.
    const rep = data.replicates[data.replicates.length - 1];
    set({ session: data, currentReplicateId: rep.replicateId, draftMeta: carriedMeta(data, rep), pendingScan: null });
    return true;
  },

  startNewReplicate: () => {
    const { session } = get();
    const n = Math.max(0, ...session.replicates.map((r) => r.replicateNumber)) + 1;
    const meta = defaultMeta(session, n);
    const rep: Replicate = { replicateId: `r${n}`, replicateNumber: n, startedAt: isoNow(), meta, scans: [] };
    set({
      session: { ...session, replicates: [...session.replicates, rep] },
      currentReplicateId: rep.replicateId,
      draftMeta: meta,
    });
  },

  beginPendingScan: (imagePath, imageDataUrl, dpi) => {
    const { session, currentReplicateId, draftMeta } = get();
    const rep = session.replicates.find((r) => r.replicateId === currentReplicateId) ?? session.replicates[0];
    const next = rep && rep.scans.length > 0 ? Math.max(...rep.scans.map((s) => s.imageNumber)) + 1 : 1;
    set({
      pendingScan: {
        imagePath,
        imageDataUrl,
        imageNumber: next,
        replicateId: rep?.replicateId ?? "",
        detection: null,
        metadata: { ...draftMeta },
        sheet: null,
        requestedDpi: dpi?.requestedDpi ?? null,
        actualDpi: dpi?.actualDpi ?? null,
        dpiSource: dpi?.dpiSource ?? null,
        cnnCount: 0,
        cnnPupae: null,
      },
    });
  },

  setDetection: (d) => set((s) => {
    if (!s.pendingScan) return s;
    const sheet = d.sheet ? { ...d.sheet, manual: false } : null;
    return {
      pendingScan: {
        ...s.pendingScan,
        detection: d,
        sheet,
        cnnCount: d.pupae.length,
        cnnPupae: d.pupae,
        actualDpi: s.pendingScan.actualDpi ?? d.imageDpi ?? null,
        dpiSource: s.pendingScan.actualDpi ? s.pendingScan.dpiSource : d.imageDpiSource,
      },
    };
  }),

  setPendingPupae: (pupae) => set((s) => {
    if (!s.pendingScan || !s.pendingScan.detection) return s;
    const list = recomputeRanks(pupae, s.pendingScan.sheet?.found ? s.pendingScan.sheet.corners : null);
    const b = bandCounts(list);
    return {
      pendingScan: {
        ...s.pendingScan,
        detection: {
          ...s.pendingScan.detection,
          pupae: list,
          counts: { total: list.length, ...b },
        },
      },
    };
  }),

  setPendingSheet: (corners, confirmOnly) => set((s) => {
    const p = s.pendingScan;
    if (!p || !p.detection) return s;
    if (!corners) {
      // Back to what the detector found.
      const orig = p.detection.sheet ? { ...p.detection.sheet, manual: false } : null;
      return {
        pendingScan: {
          ...p, sheet: orig,
          detection: { ...p.detection, pupae: withSheetPct(p.detection.pupae, orig?.found ? orig.corners : null) },
        },
      };
    }
    const sheet: SheetInfo = { ...(p.sheet ?? { found: true, method: "manual" }), found: true, corners, manual: true, ...geometry(corners) };
    if (confirmOnly && p.sheet) sheet.confidence = p.sheet.confidence;
    return {
      pendingScan: { ...p, sheet, detection: { ...p.detection, pupae: withSheetPct(p.detection.pupae, corners) } },
    };
  }),

  updateMeta: (m) => set((s) => {
    const draftMeta = { ...s.draftMeta, ...m };
    // Remember the values on the replicate so the next scan (and the next
    // app start) begins from them.
    const targetRep = s.pendingScan?.replicateId || s.currentReplicateId;
    let session = {
      ...s.session,
      replicates: s.session.replicates.map((r) => (r.replicateId === targetRep ? { ...r, meta: draftMeta } : r)),
    };
    if (m.operator !== undefined) session = { ...session, operator: m.operator };
    if (m.experiment !== undefined) session = { ...session, experiment: m.experiment };
    return {
      draftMeta,
      session,
      pendingScan: s.pendingScan ? { ...s.pendingScan, metadata: { ...s.pendingScan.metadata, ...m } } : null,
    };
  }),

  commitPendingScan: () => {
    const { pendingScan, session } = get();
    if (!pendingScan || !pendingScan.detection) return null;
    const targetId = pendingScan.replicateId || get().currentReplicateId;
    const rep = session.replicates.find((r) => r.replicateId === targetId);
    if (!rep) return null;
    const d = pendingScan.detection;
    const cnnLeft = d.pupae.filter((p) => p.source === "cnn").length;
    const originalCnn = pendingScan.cnnCount;
    const record: ScanRecord = {
      ...pendingScan.metadata,
      id: `s_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`,
      replicateNumber: rep.replicateNumber,
      imageNumber: pendingScan.imageNumber,
      timestamp: isoNow(),
      imagePath: pendingScan.imagePath,
      imageWidth: d.imageWidth,
      imageHeight: d.imageHeight,
      totalPupae: d.counts.total,
      top5Selected: top5Count(d.counts.total),
      top5PctCount: d.counts.top5Pct,
      rank5To25Count: d.counts.rank5To25,
      middle50Count: d.counts.middle50,
      bottom25Count: d.counts.bottom25,
      yMin: d.pupae.length ? Math.min(...d.pupae.map((p) => p.y)) : null,
      yMax: d.pupae.length ? Math.max(...d.pupae.map((p) => p.y)) : null,
      manuallyEdited: d.pupae.some((p) => p.source === "manual") || cnnLeft < originalCnn,
      pupae: d.pupae,
      cnnCount: originalCnn,
      requestedDpi: pendingScan.requestedDpi,
      actualDpi: pendingScan.actualDpi,
      dpiSource: pendingScan.dpiSource,
      trainDpi: d.trainDpi,
      inferenceScale: d.inferenceScale,
      modelVersion: d.modelVersion,
      sheet: pendingScan.sheet,
      analysis: d.analysis ?? null,
      suspects: d.suspects,
    };
    set({
      session: {
        ...session,
        replicates: session.replicates.map((r) =>
          r.replicateId === targetId ? { ...r, meta: pendingScan.metadata, scans: [...r.scans, record] } : r),
      },
      pendingScan: null,
    });
    return record;
  },

  clearPendingScan: () => set({ pendingScan: null }),
}));

function geometry(c: Corner[]) {
  const [tl, tr, br, bl] = c;
  const ax = (tl[0] + tr[0]) / 2 - (bl[0] + br[0]) / 2;
  const ay = (tl[1] + tr[1]) / 2 - (bl[1] + br[1]) / 2;
  const widthPx = (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2;
  return {
    lengthPx: Math.round(Math.hypot(ax, ay) * 10) / 10,
    widthPx: Math.round(widthPx * 10) / 10,
    angleDeg: Math.round((Math.atan2(ax, -ay) * 18000) / Math.PI) / 100,
  };
}

/** A finished, real (non-mock) detection that is not in the database yet. */
export function hasUnsavedScan(s: { pendingScan: PendingScan | null }): boolean {
  const m = s.pendingScan?.detection?.modelVersion?.toLowerCase() ?? "";
  return !!s.pendingScan?.detection && !m.includes("mock") && !m.includes("synthetic");
}

export function currentReplicate(s: { session: Session; currentReplicateId: string }): Replicate {
  return s.session.replicates.find((r) => r.replicateId === s.currentReplicateId)
    ?? s.session.replicates[s.session.replicates.length - 1];
}
