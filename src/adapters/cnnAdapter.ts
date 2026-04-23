/**
 * CNN detection adapter.
 *
 * Contract with the UI:
 *   • In Electron (window.pupa.cnn.detect exists) we run the REAL V12 +
 *     clf_v5 pipeline via a persistent Python worker. If that worker
 *     fails we THROW — never silently fall back to a mock. The UI is
 *     responsible for catching the error, showing it to the operator,
 *     and keeping the Save button disabled so fabricated data cannot
 *     end up in the database.
 *   • Outside Electron (plain `vite` in a browser tab) there is no
 *     Python available, so we return a deterministic mock. Every mock
 *     response is clearly tagged in `modelVersion` so it cannot be
 *     confused with a real detection.
 *   • Explicit opt-in: passing VITE_CNN_MOCK=1 at build time or setting
 *     window.__PUPA_FORCE_MOCK__ = true in the renderer forces the mock
 *     path even inside Electron (useful for UI-only demos).
 */
import type { DetectionResult, Pupa, RankBand } from "../types";

export class CnnUnavailableError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "CnnUnavailableError";
  }
}

function bandFor(rankPct: number): RankBand {
  if (rankPct < 5) return "0-5%";
  if (rankPct < 25) return "5-25%";
  if (rankPct < 75) return "25-75%";
  return "75-100%";
}

function mockEnabled(): boolean {
  // Flag set by either Vite env or a renderer-global for live toggling.
  try {
    if ((globalThis as any).__PUPA_FORCE_MOCK__ === true) return true;
    const env = (import.meta as any).env;
    if (env && env.VITE_CNN_MOCK === "1") return true;
  } catch {}
  return false;
}

export async function runDetection(
  imagePath: string,
  imageWidth: number = 1116,
  imageHeight: number = 2586
): Promise<DetectionResult> {
  const inElectron = !!window.pupa?.cnn?.detect;

  if (inElectron && !mockEnabled()) {
    const t0 = performance.now();
    let raw;
    try {
      raw = await window.pupa!.cnn.detect(imagePath);
    } catch (err) {
      // Rethrow so the caller knows detection failed. Do NOT fall
      // through to mock — fabricated data must never reach the DB.
      throw new CnnUnavailableError(
        `CNN worker failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    const durationMs = Math.round(performance.now() - t0);
    return {
      imageWidth: raw.imageWidth,
      imageHeight: raw.imageHeight,
      pupae: raw.pupae,
      counts: raw.counts,
      yMin: raw.yMin,
      yMax: raw.yMax,
      modelVersion: raw.modelVersion,
      durationMs,
    };
  }

  // Browser-only preview OR explicit mock override. Make it obvious.
  return mockDetection(imagePath, imageWidth, imageHeight);
}

// ---- mock fallback (browser-only preview or explicit opt-in) --------------

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function mockDetection(
  imagePath: string,
  imageWidth: number,
  imageHeight: number
): Promise<DetectionResult> {
  const seedBase = Array.from(imagePath).reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = mulberry32(seedBase);
  const n = 55 + Math.floor(rand() * 30);
  const pupae: Pupa[] = [];
  for (let i = 0; i < n; i++) {
    const x = 40 + Math.floor(rand() * (imageWidth - 80));
    const y = 50 + Math.floor(rand() * (imageHeight - 100));
    pupae.push({ index: i + 1, x, y, rankPct: 0, band: "25-75%", source: "cnn" });
  }
  const ys = pupae.map((p) => p.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yRange = Math.max(1, yMax - yMin);
  for (const p of pupae) {
    p.rankPct = Number(((yMax - p.y) / yRange * 100).toFixed(2));
    p.band = bandFor(p.rankPct);
  }
  const counts = {
    total: pupae.length,
    top5Pct: pupae.filter((p) => p.band === "0-5%").length,
    rank5To25: pupae.filter((p) => p.band === "5-25%").length,
    middle50: pupae.filter((p) => p.band === "25-75%").length,
    bottom25: pupae.filter((p) => p.band === "75-100%").length,
  };
  await new Promise((r) => setTimeout(r, 400));
  return {
    imageWidth,
    imageHeight,
    pupae,
    counts,
    yMin,
    yMax,
    modelVersion: "MOCK — synthetic data, NOT a real detection",
    durationMs: 400,
  };
}
