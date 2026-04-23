/**
 * CNN detection adapter.
 *
 * Uses the REAL V12 + clf_v5 pipeline via Electron IPC → Python subprocess
 * when available (window.pupa.cnn.detect). Falls back to a deterministic
 * mock when running in a plain browser (e.g. `vite` without `electron`).
 */
import type { DetectionResult, Pupa, RankBand } from "../types";

function bandFor(rankPct: number): RankBand {
  if (rankPct < 5) return "0-5%";
  if (rankPct < 25) return "5-25%";
  if (rankPct < 75) return "25-75%";
  return "75-100%";
}

export async function runDetection(
  imagePath: string,
  imageWidth: number = 1116,
  imageHeight: number = 2586
): Promise<DetectionResult> {
  if (window.pupa?.cnn?.detect) {
    const t0 = performance.now();
    try {
      const raw = await window.pupa.cnn.detect(imagePath);
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
    } catch (err) {
      console.error("Real CNN failed, falling back to mock:", err);
      // fall through to mock so the UI still works during dev.
    }
  }
  return mockDetection(imagePath, imageWidth, imageHeight);
}

// ---- mock fallback --------------------------------------------------------

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
    modelVersion: "mock (Python subprocess unavailable)",
    durationMs: 400,
  };
}
