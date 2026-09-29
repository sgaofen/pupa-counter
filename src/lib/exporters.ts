// CSV / XLSX table builders for the Data page.
import type { ScanRecord, Session, XlsxSheet } from "../types";
import { recordTop5, top5Indices } from "./bands";

type Cell = string | number | boolean | null;

export interface RunningRow {
  scan: ScanRecord;
  repTotal: number;
  repTop5: number;
  sessTotal: number;
  sessTop5: number;
}

/** Scans in session order with running totals (per replicate and per session). */
export function runningRows(session: Session): RunningRow[] {
  const out: RunningRow[] = [];
  let sessTotal = 0, sessTop5 = 0;
  for (const rep of session.replicates) {
    let repTotal = 0, repTop5 = 0;
    for (const scan of rep.scans) {
      const t5 = recordTop5(scan);
      repTotal += scan.totalPupae; repTop5 += t5;
      sessTotal += scan.totalPupae; sessTop5 += t5;
      out.push({ scan, repTotal, repTop5, sessTotal, sessTop5 });
    }
  }
  return out;
}

const fix = (v: number | null | undefined, d = 2): Cell =>
  v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d));

export const SCAN_HEADER = [
  "session_id", "replicate", "scan_id", "image_num", "timestamp",
  "operator", "experiment", "genotype", "comments", "info_filename",
  "total_pupae", "top5_selected",
  "running_total_replicate", "running_top5_replicate",
  "running_total_session", "running_top5_session",
  "rank_0_5_count", "rank_5_25_count", "rank_25_75_count", "rank_75_100_count",
  "manually_edited", "cnn_count", "manual_points",
  "image_width", "image_height", "requested_dpi", "actual_dpi", "dpi_source",
  "sheet_found", "sheet_confidence", "sheet_method", "sheet_manual",
  "sheet_truncated_top", "sheet_truncated_bottom", "sheet_length_px", "sheet_width_px",
  "sheet_angle_deg", "sheet_corners_tl_tr_br_bl",
  "model", "image_path",
];

export function scanRows(session: Session, replicateNumber?: number): Cell[][] {
  return runningRows(session)
    .filter((r) => replicateNumber == null || r.scan.replicateNumber === replicateNumber)
    .map(({ scan: s, repTotal, repTop5, sessTotal, sessTop5 }) => {
      const sh = s.sheet;
      const corners = sh?.found && sh.corners?.length === 4
        ? sh.corners.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join("; ")
        : "";
      return [
        session.sessionId, s.replicateNumber, s.id, s.imageNumber, s.timestamp,
        s.operator, s.experiment, s.genotype, (s.comments ?? "").replace(/[\r\n]+/g, " "), s.infoFilename,
        s.totalPupae, recordTop5(s),
        repTotal, repTop5, sessTotal, sessTop5,
        s.top5PctCount, s.rank5To25Count, s.middle50Count, s.bottom25Count,
        s.manuallyEdited, s.cnnCount ?? null, s.pupae.filter((p) => p.source === "manual").length,
        s.imageWidth, s.imageHeight, s.requestedDpi ?? null, s.actualDpi ?? null, s.dpiSource ?? null,
        sh ? !!sh.found : null, fix(sh?.confidence ?? null, 3), sh?.method ?? null, sh ? !!sh.manual : null,
        sh ? !!sh.truncatedTop : null, sh ? !!sh.truncatedBottom : null,
        fix(sh?.lengthPx ?? null, 1), fix(sh?.widthPx ?? null, 1), fix(sh?.angleDeg ?? null, 2), corners,
        s.modelVersion ?? null, s.imagePath,
      ];
    });
}

export const PUPA_HEADER = [
  "session_id", "replicate", "scan_id", "image_num", "timestamp", "genotype",
  "pupa_idx", "x", "y", "rank_pct", "band", "in_top5", "sheet_pct",
  "source", "cnn_score", "cnn_prob", "image_width", "image_height", "actual_dpi",
];

export function pupaRows(session: Session, replicateNumber?: number): Cell[][] {
  const out: Cell[][] = [];
  for (const rep of session.replicates) {
    if (replicateNumber != null && rep.replicateNumber !== replicateNumber) continue;
    for (const s of rep.scans) {
      const top = top5Indices(s.pupae);
      s.pupae.forEach((p, i) => {
        out.push([
          session.sessionId, s.replicateNumber, s.id, s.imageNumber, s.timestamp, s.genotype,
          p.index, p.x, p.y, fix(p.rankPct), p.band, top.has(i), fix(p.sheetPct ?? null),
          p.source, fix(p.score ?? null, 3), fix(p.prob ?? null, 3),
          s.imageWidth, s.imageHeight, s.actualDpi ?? null,
        ]);
      });
    }
  }
  return out;
}

function csvField(v: Cell): string {
  if (v == null) return "";
  const s = typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export function xlsxSheets(session: Session, replicateNumber?: number): XlsxSheet[] {
  return [
    { name: "Scans", header: SCAN_HEADER, rows: scanRows(session, replicateNumber) },
    { name: "Pupae", header: PUPA_HEADER, rows: pupaRows(session, replicateNumber) },
  ];
}

export function exportBaseName(session: Session, replicateNumber?: number): string {
  const tag = replicateNumber != null ? `_replicate${replicateNumber}` : "";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `${session.sessionId || "session"}${tag}_${stamp}`;
}
