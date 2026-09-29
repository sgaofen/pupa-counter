// Session file <-> in-memory conversion.
//
// On disk (all versions): { sessionId, operator, experiment, startedAt,
//   rounds: [{ roundId, roundNumber, startedAt, scans: [{ roundNumber, ... }] }] }
// v0.5 adds `schemaVersion: 2`, per-replicate `meta`, and optional scan
// fields (top5Selected, actualDpi, sheet, ...). Keeping the old key names
// means a v0.4 install can still open a file written by v0.5.
//
// In memory the app uses replicate naming. `normalizeSession` also accepts
// files that already use `replicates` / `replicateNumber`, so either
// spelling loads. Unknown fields are carried through untouched.
import type { Replicate, ScanRecord, Session } from "../types";
import { top5Count } from "./bands";

export const SCHEMA_VERSION = 2;

type Raw = Record<string, any>;

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeScan(raw: Raw, replicateNumber: number): ScanRecord {
  const { roundNumber, replicateNumber: rn, ...rest } = raw ?? {};
  const pupae = Array.isArray(raw?.pupae) ? raw.pupae : [];
  const total = num(raw?.totalPupae, pupae.length);
  return {
    ...rest,
    replicateNumber: num(rn ?? roundNumber, replicateNumber),
    imageNumber: num(raw?.imageNumber, 0),
    operator: raw?.operator ?? "",
    experiment: raw?.experiment ?? "",
    genotype: raw?.genotype ?? "",
    comments: raw?.comments ?? "",
    infoFilename: raw?.infoFilename ?? "",
    totalPupae: total,
    top5Selected: typeof raw?.top5Selected === "number" ? raw.top5Selected : top5Count(total),
    top5PctCount: num(raw?.top5PctCount, 0),
    rank5To25Count: num(raw?.rank5To25Count, 0),
    middle50Count: num(raw?.middle50Count, 0),
    bottom25Count: num(raw?.bottom25Count, 0),
    manuallyEdited: !!raw?.manuallyEdited,
    pupae,
  } as ScanRecord;
}

export function normalizeSession(raw: unknown): Session | null {
  const d = raw as Raw;
  if (!d || typeof d !== "object" || !d.sessionId) return null;
  const reps: Raw[] = Array.isArray(d.rounds) ? d.rounds : Array.isArray(d.replicates) ? d.replicates : [];
  const { rounds, replicates, schemaVersion, ...rest } = d;
  const out: Session = {
    ...rest,
    sessionId: String(d.sessionId),
    operator: d.operator ?? "",
    experiment: d.experiment ?? "",
    startedAt: d.startedAt ?? "",
    replicates: reps.map((r, i): Replicate => {
      const { roundId, roundNumber, replicateId, replicateNumber, scans, ...rrest } = r ?? {};
      const n = num(replicateNumber ?? roundNumber, i + 1);
      return {
        ...rrest,
        replicateId: String(replicateId ?? roundId ?? `r${n}`),
        replicateNumber: n,
        startedAt: r?.startedAt ?? "",
        scans: (Array.isArray(scans) ? scans : []).map((s: Raw) => normalizeScan(s, n)),
      };
    }),
  };
  if (out.replicates.length === 0) {
    out.replicates.push({ replicateId: "r1", replicateNumber: 1, startedAt: out.startedAt, scans: [] });
  }
  return out;
}

export function serializeSession(s: Session): Raw {
  const { replicates, ...rest } = s;
  return {
    schemaVersion: SCHEMA_VERSION,
    ...rest,
    rounds: replicates.map((r) => {
      const { replicateId, replicateNumber, scans, ...rrest } = r;
      return {
        roundId: replicateId,
        roundNumber: replicateNumber,
        ...rrest,
        scans: scans.map((sc) => {
          const { replicateNumber: rn, ...srest } = sc;
          return { ...srest, roundNumber: rn };
        }),
      };
    }),
  };
}
