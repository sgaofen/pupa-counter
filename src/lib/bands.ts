import type { Corner, Pupa, RankBand, ScanRecord } from "../types";
import { sheetRelativePct } from "./sheetPct";

/** Rank convention (unchanged since v0.3): rank 0 % = lowest pupa in the
 *  image (largest y), rank 100 % = highest pupa (smallest y). The 0–5 % band
 *  is the "top of the ranking". */
export function bandFor(rankPct: number): RankBand {
  if (rankPct < 5) return "0-5%";
  if (rankPct < 25) return "5-25%";
  if (rankPct < 75) return "25-75%";
  return "75-100%";
}

/** Recompute rank %, band, index (and sheet % when an outline exists)
 *  after a manual edit. Same arithmetic the editor has always used. */
export function recomputeRanks(list: Pupa[], corners?: Corner[] | null): Pupa[] {
  if (list.length === 0) return list;
  const ys = list.map((p) => p.y);
  const yMax = Math.max(...ys);
  const yMin = Math.min(...ys);
  const range = Math.max(1, yMax - yMin);
  const hasSheet = !!corners && corners.length === 4;
  return list.map((p, i) => {
    const rank = ((yMax - p.y) / range) * 100;
    return {
      ...p,
      index: i + 1,
      rankPct: Number(rank.toFixed(2)),
      band: bandFor(rank),
      sheetPct: hasSheet ? Number(sheetRelativePct(corners!, p.x, p.y).toFixed(2)) : p.sheetPct ?? null,
    };
  });
}

export function withSheetPct(list: Pupa[], corners?: Corner[] | null): Pupa[] {
  if (!corners || corners.length !== 4) return list.map((p) => ({ ...p, sheetPct: null }));
  return list.map((p) => ({ ...p, sheetPct: Number(sheetRelativePct(corners, p.x, p.y).toFixed(2)) }));
}

/** Number of pupae picked as the "top 5 %": 5 % of the count, rounded,
 *  at least one when there are any pupae (100 → 5, 23 → 1). */
export function top5Count(total: number): number {
  return total > 0 ? Math.max(1, Math.round(total * 0.05)) : 0;
}

/** Indices (into `pupae`) of the pupae that make up the top 5 %:
 *  the lowest rank values, i.e. closest to the image bottom. */
export function top5Indices(pupae: Pupa[]): Set<number> {
  const n = top5Count(pupae.length);
  const order = pupae
    .map((p, i) => ({ i, r: p.rankPct, y: p.y }))
    .sort((a, b) => a.r - b.r || b.y - a.y);
  return new Set(order.slice(0, n).map((o) => o.i));
}

export function bandCounts(pupae: Pupa[]) {
  return {
    top5Pct: pupae.filter((p) => p.band === "0-5%").length,
    rank5To25: pupae.filter((p) => p.band === "5-25%").length,
    middle50: pupae.filter((p) => p.band === "25-75%").length,
    bottom25: pupae.filter((p) => p.band === "75-100%").length,
  };
}

/** Top-5 % count for any record, including pre-v0.5 ones that never stored it. */
export function recordTop5(r: ScanRecord): number {
  return typeof r.top5Selected === "number" ? r.top5Selected : top5Count(r.totalPupae);
}

/** Below this sheet-detector confidence the UI asks the operator to check
 *  the outline (sheet detection agent's recommendation). */
export const SHEET_CONFIRM_BELOW = 0.6;

export function sheetNeedsCheck(sheet: { found?: boolean; manual?: boolean; confidence?: number } | null | undefined): boolean {
  return !!sheet && !!sheet.found && !sheet.manual && (sheet.confidence ?? 0) < SHEET_CONFIRM_BELOW;
}
