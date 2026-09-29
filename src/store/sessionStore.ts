import { create } from "zustand";
import type {
  Corner, DetectionResult, Pupa, Replicate, ScanMeta, ScanRecord, Session, SheetInfo, Suspect,
} from "../types";
import { bandCounts, recomputeRanks, top5Count, withSheetPct } from "../lib/bands";
import { normalizeSession } from "../lib/sessionSchema";
import { sheetRelativePct } from "../lib/sheetPct";
import { startingGenotype, useSettings } from "./settingsStore";

// sv-SE yields "YYYY-MM-DD HH:MM:SS"; pinned to LA wall-clock so the lab's
// timestamps read the same on any machine.
const LA_DT_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Los_Angeles",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});
export function isoNow(): string {
  return LA_DT_FMT.format(new Date()).replace(",", "");
}

function newScanId(): string {
  return `s_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
}

export type Stage = "idle" | "scanning" | "detecting" | "ready" | "error";

interface Snapshot { pupae: Pupa[]; sheet: SheetInfo | null }

export interface WorkState {
  /** The record being viewed / edited. When `persisted`, every edit is
   *  written straight into the session (auto-save). */
  record: ScanRecord;
  persisted: boolean;
  mock: boolean;
  imageDataUrl: string | null;
  cnnPupae: Pupa[];
  undo: Snapshot[];
  redo: Snapshot[];
}

export interface ScanOrigin {
  imagePath: string;
  imageDataUrl: string | null;
  requestedDpi?: number | null;
  actualDpi?: number | null;
  dpiSource?: string | null;
  scanWarnings?: string[];
}

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
    operator: r.operator ?? "",
    experiment: r.experiment ?? "",
    genotype: r.genotype ?? "",
    comments: r.comments ?? "",
    infoFilename: r.infoFilename ?? "",
  };
}

/** Metadata the next scan of `rep` starts with: whatever the replicate
 *  last used, else the defaults. */
function carriedMeta(session: Session, rep: Replicate | undefined): ScanMeta {
  if (!rep) return defaultMeta(session, 1);
  if (rep.meta) return metaOf(rep.meta);
  const last = rep.scans[rep.scans.length - 1];
  return last ? metaOf(last) : defaultMeta(session, rep.replicateNumber);
}

/** Derived fields of a record from its pupae (totals, bands, edit flag). */
function finalize(r: ScanRecord): ScanRecord {
  const pupae = r.pupae;
  const b = bandCounts(pupae);
  const ys = pupae.map((p) => p.y);
  const cnnLeft = pupae.filter((p) => p.source === "cnn").length;
  const manual = pupae.some((p) => p.source === "manual");
  const removed = typeof r.cnnCount === "number" ? r.cnnCount - cnnLeft : 0;
  return {
    ...r,
    totalPupae: pupae.length,
    top5Selected: top5Count(pupae.length),
    top5PctCount: b.top5Pct,
    rank5To25Count: b.rank5To25,
    middle50Count: b.middle50,
    bottom25Count: b.bottom25,
    yMin: ys.length ? Math.min(...ys) : null,
    yMax: ys.length ? Math.max(...ys) : null,
    manuallyEdited: manual || removed > 0 || r.manuallyEdited && typeof r.cnnCount !== "number",
  };
}

function replaceRecord(session: Session, rec: ScanRecord): Session {
  return {
    ...session,
    replicates: session.replicates.map((rep) =>
      rep.scans.some((s) => s.id === rec.id)
        ? { ...rep, scans: rep.scans.map((s) => (s.id === rec.id ? rec : s)) }
        : rep
    ),
  };
}

function emptySession(): Session {
  const now = isoNow();
  return {
    sessionId: "",
    operator: "",
    experiment: "",
    startedAt: now,
    replicates: [{ replicateId: "r1", replicateNumber: 1, startedAt: now, scans: [] }],
  };
}

interface SessionState {
  session: Session;
  currentReplicateId: string;
  draftMeta: ScanMeta;
  work: WorkState | null;
  stage: Stage;
  stageDetail: string;
  error: string | null;
  lastDiscarded: { record: ScanRecord; replicateId: string; index: number } | null;

  loadSession: (raw: unknown) => boolean;
  setOperator: (name: string) => void;
  setExperiment: (name: string) => void;
  startNewReplicate: () => void;
  selectReplicate: (id: string) => void;
  updateMeta: (m: Partial<ScanMeta>) => void;

  setStage: (stage: Stage, detail?: string) => void;
  setError: (msg: string | null) => void;
  acceptDetection: (origin: ScanOrigin, d: DetectionResult, mock: boolean) => ScanRecord;
  openRecord: (record: ScanRecord, imageDataUrl: string | null) => void;
  closeWork: () => void;

  editPupae: (next: Pupa[]) => void;
  setSheetCorners: (corners: Corner[], commit: boolean) => void;
  acceptSuspect: (s: Suspect) => void;
  undo: () => void;
  redo: () => void;
  revertToCnn: () => void;
  discardWork: () => void;
  restoreDiscarded: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => {
  /** Apply a change to the working record, with undo + auto-save. */
  const applyWork = (fn: (r: ScanRecord) => ScanRecord, pushUndo = true) => {
    const { work, session } = get();
    if (!work) return;
    const snap: Snapshot = { pupae: work.record.pupae, sheet: work.record.sheet ?? null };
    const record = finalize(fn(work.record));
    const nextWork: WorkState = {
      ...work,
      record,
      undo: pushUndo ? [...work.undo.slice(-99), snap] : work.undo,
      redo: pushUndo ? [] : work.redo,
    };
    set({
      work: nextWork,
      session: work.persisted ? replaceRecord(session, record) : session,
    });
  };

  return {
    session: emptySession(),
    currentReplicateId: "r1",
    draftMeta: defaultMeta(emptySession(), 1),
    work: null,
    stage: "idle",
    stageDetail: "",
    error: null,
    lastDiscarded: null,

    loadSession: (raw) => {
      const data = normalizeSession(raw);
      if (!data) return false;
      const rep = data.replicates[data.replicates.length - 1];
      set({
        session: data,
        currentReplicateId: rep.replicateId,
        draftMeta: carriedMeta(data, rep),
        work: null,
        stage: "idle",
        error: null,
        lastDiscarded: null,
      });
      return true;
    },

    setOperator: (name) => set((s) => ({
      session: { ...s.session, operator: name },
      draftMeta: { ...s.draftMeta, operator: name },
    })),
    setExperiment: (name) => set((s) => ({
      session: { ...s.session, experiment: name },
      draftMeta: { ...s.draftMeta, experiment: name },
    })),

    startNewReplicate: () => {
      const { session } = get();
      const n = Math.max(0, ...session.replicates.map((r) => r.replicateNumber)) + 1;
      const meta = defaultMeta(session, n);
      const rep: Replicate = {
        replicateId: `r${n}`,
        replicateNumber: n,
        startedAt: isoNow(),
        meta,
        scans: [],
      };
      set({
        session: { ...session, replicates: [...session.replicates, rep] },
        currentReplicateId: rep.replicateId,
        draftMeta: meta,
        work: null,
        stage: "idle",
        error: null,
      });
    },

    selectReplicate: (id) => {
      const { session } = get();
      const rep = session.replicates.find((r) => r.replicateId === id);
      if (!rep) return;
      set({ currentReplicateId: id, draftMeta: carriedMeta(session, rep) });
    },

    updateMeta: (m) => {
      const { work, session, currentReplicateId, draftMeta } = get();
      const inCurrent = !work || work.record.replicateNumber ===
        session.replicates.find((r) => r.replicateId === currentReplicateId)?.replicateNumber;
      let nextSession = session;
      let nextDraft = draftMeta;
      if (inCurrent) {
        nextDraft = { ...draftMeta, ...m };
        nextSession = {
          ...nextSession,
          replicates: nextSession.replicates.map((r) =>
            r.replicateId === currentReplicateId ? { ...r, meta: nextDraft } : r),
        };
      }
      if (m.operator !== undefined) nextSession = { ...nextSession, operator: m.operator };
      if (m.experiment !== undefined) nextSession = { ...nextSession, experiment: m.experiment };
      let nextWork = work;
      if (work) {
        const record = { ...work.record, ...m };
        nextWork = { ...work, record };
        if (work.persisted) nextSession = replaceRecord(nextSession, record);
      }
      set({ session: nextSession, draftMeta: nextDraft, work: nextWork });
    },

    setStage: (stage, detail = "") => set({ stage, stageDetail: detail }),
    setError: (msg) => set({ error: msg, stage: msg ? "error" : get().stage }),

    acceptDetection: (origin, d, mock) => {
      const { session, currentReplicateId, draftMeta } = get();
      const rep = session.replicates.find((r) => r.replicateId === currentReplicateId)
        ?? session.replicates[session.replicates.length - 1];
      const nextImage = rep.scans.length ? Math.max(...rep.scans.map((s) => s.imageNumber)) + 1 : 1;
      const sheet: SheetInfo | null = d.sheet ? { ...d.sheet, manual: false } : null;
      const record = finalize({
        ...draftMeta,
        id: newScanId(),
        replicateNumber: rep.replicateNumber,
        imageNumber: nextImage,
        timestamp: isoNow(),
        imagePath: origin.imagePath,
        imageWidth: d.imageWidth,
        imageHeight: d.imageHeight,
        totalPupae: d.pupae.length,
        top5Selected: 0,
        top5PctCount: d.counts.top5Pct,
        rank5To25Count: d.counts.rank5To25,
        middle50Count: d.counts.middle50,
        bottom25Count: d.counts.bottom25,
        yMin: d.yMin,
        yMax: d.yMax,
        manuallyEdited: false,
        pupae: d.pupae,
        cnnCount: d.pupae.length,
        requestedDpi: origin.requestedDpi ?? null,
        actualDpi: origin.actualDpi ?? d.imageDpi ?? null,
        dpiSource: origin.actualDpi ? origin.dpiSource ?? "scanner" : d.imageDpiSource,
        trainDpi: d.trainDpi,
        inferenceScale: d.inferenceScale,
        modelVersion: d.modelVersion,
        sheet,
        suspects: d.suspects,
      });
      const work: WorkState = {
        record, persisted: !mock, mock, imageDataUrl: origin.imageDataUrl,
        cnnPupae: d.pupae, undo: [], redo: [],
      };
      set({
        work,
        stage: "ready",
        error: null,
        session: mock ? session : {
          ...session,
          replicates: session.replicates.map((r) =>
            r.replicateId === rep.replicateId ? { ...r, meta: draftMeta, scans: [...r.scans, record] } : r),
        },
      });
      return record;
    },

    openRecord: (record, imageDataUrl) => {
      const cnn = record.pupae.filter((p) => p.source === "cnn");
      set({
        work: {
          record, persisted: true, mock: false, imageDataUrl,
          cnnPupae: cnn, undo: [], redo: [],
        },
        stage: "ready",
        error: null,
      });
    },

    closeWork: () => set({ work: null, stage: "idle", error: null }),

    editPupae: (next) => applyWork((r) => ({ ...r, pupae: recomputeRanks(next, r.sheet?.corners) })),

    setSheetCorners: (corners, commit) => {
      const { work } = get();
      if (!work) return;
      const apply = (r: ScanRecord): ScanRecord => {
        const sheet: SheetInfo = {
          ...(r.sheet ?? { found: true, method: "manual" }),
          found: true,
          corners,
          manual: true,
          ...geometry(corners),
        };
        return { ...r, sheet, pupae: withSheetPct(r.pupae, corners) };
      };
      if (commit) {
        applyWork(apply, true);
      } else {
        // Live drag preview: update the working copy only; the final
        // mouse-up commits with an undo step and a save.
        set({ work: { ...work, record: finalize(apply(work.record)) } });
      }
    },

    acceptSuspect: (s) => {
      const { work } = get();
      if (!work) return;
      applyWork((r) => ({
        ...r,
        suspects: (r.suspects ?? []).filter((q) => q !== s && !(q.x === s.x && q.y === s.y)),
        pupae: recomputeRanks([
          ...r.pupae,
          { index: r.pupae.length + 1, x: s.x, y: s.y, rankPct: 0, band: "25-75%", source: "manual" },
        ], r.sheet?.corners),
      }));
    },

    undo: () => {
      const { work, session } = get();
      if (!work || work.undo.length === 0) return;
      const prev = work.undo[work.undo.length - 1];
      const cur: Snapshot = { pupae: work.record.pupae, sheet: work.record.sheet ?? null };
      const record = finalize({ ...work.record, pupae: prev.pupae, sheet: prev.sheet });
      set({
        work: { ...work, record, undo: work.undo.slice(0, -1), redo: [...work.redo, cur] },
        session: work.persisted ? replaceRecord(session, record) : session,
      });
    },

    redo: () => {
      const { work, session } = get();
      if (!work || work.redo.length === 0) return;
      const next = work.redo[work.redo.length - 1];
      const cur: Snapshot = { pupae: work.record.pupae, sheet: work.record.sheet ?? null };
      const record = finalize({ ...work.record, pupae: next.pupae, sheet: next.sheet });
      set({
        work: { ...work, record, redo: work.redo.slice(0, -1), undo: [...work.undo, cur] },
        session: work.persisted ? replaceRecord(session, record) : session,
      });
    },

    revertToCnn: () => applyWork((r) => ({ ...r, pupae: recomputeRanks(get().work!.cnnPupae, r.sheet?.corners) })),

    discardWork: () => {
      const { work, session } = get();
      if (!work) return;
      if (!work.persisted) { set({ work: null, stage: "idle" }); return; }
      let found: { replicateId: string; index: number } | null = null;
      const replicates = session.replicates.map((rep) => {
        const idx = rep.scans.findIndex((s) => s.id === work.record.id);
        if (idx < 0) return rep;
        found = { replicateId: rep.replicateId, index: idx };
        return { ...rep, scans: rep.scans.filter((s) => s.id !== work.record.id) };
      });
      set({
        session: { ...session, replicates },
        work: null,
        stage: "idle",
        lastDiscarded: found ? { record: work.record, ...(found as { replicateId: string; index: number }) } : null,
      });
    },

    restoreDiscarded: () => {
      const { lastDiscarded, session } = get();
      if (!lastDiscarded) return;
      const replicates = session.replicates.map((rep) => {
        if (rep.replicateId !== lastDiscarded.replicateId) return rep;
        const scans = [...rep.scans];
        scans.splice(Math.min(lastDiscarded.index, scans.length), 0, lastDiscarded.record);
        return { ...rep, scans };
      });
      set({ session: { ...session, replicates }, lastDiscarded: null });
    },
  };
});

function geometry(c: Corner[]) {
  const [tl, tr, br, bl] = c;
  const top = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
  const bot = [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2];
  const ax = top[0] - bot[0], ay = top[1] - bot[1];
  const lengthPx = Math.hypot(ax, ay);
  const widthPx = (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2;
  const angleDeg = (Math.atan2(ax, -ay) * 180) / Math.PI;
  return {
    lengthPx: Math.round(lengthPx * 10) / 10,
    widthPx: Math.round(widthPx * 10) / 10,
    angleDeg: Math.round(angleDeg * 100) / 100,
  };
}

// Convenience selectors ----------------------------------------------------------

export function currentReplicate(s: { session: Session; currentReplicateId: string }): Replicate {
  return s.session.replicates.find((r) => r.replicateId === s.currentReplicateId)
    ?? s.session.replicates[s.session.replicates.length - 1];
}

export { sheetRelativePct };
