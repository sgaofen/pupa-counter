/**
 * CNN detection adapter.
 *
 *  • In Electron we call the real Python daemon. If it fails we THROW —
 *    never fall back to fake data. The UI shows the error and nothing is
 *    saved.
 *  • Outside Electron (plain `vite` in a browser tab) there is no Python,
 *    so we return a clearly tagged mock. Mock results are never saved.
 *  • VITE_CNN_MOCK=1 or window.__PUPA_FORCE_MOCK__ = true forces the mock.
 */
import type { DetectionResult, Pupa } from "../types";
import { recomputeRanks } from "../lib/bands";

export class CnnUnavailableError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "CnnUnavailableError";
  }
}

function mockEnabled(): boolean {
  try {
    if ((globalThis as any).__PUPA_FORCE_MOCK__ === true) return true;
    const env = (import.meta as any).env;
    if (env && env.VITE_CNN_MOCK === "1") return true;
  } catch { /* ignore */ }
  return false;
}

export function isMockModel(modelVersion?: string | null): boolean {
  if (!modelVersion) return false;
  const m = modelVersion.toLowerCase();
  return m.includes("mock") || m.includes("synthetic");
}

export async function runDetection(
  imagePath: string,
  opts: { dpi?: number | null; width?: number; height?: number } = {}
): Promise<DetectionResult> {
  const inElectron = !!window.pupa?.cnn?.detect;
  if (inElectron && !mockEnabled()) {
    const t0 = performance.now();
    let raw: any;
    try {
      raw = await window.pupa!.cnn.detect(imagePath, { dpi: opts.dpi ?? null });
    } catch (err) {
      throw new CnnUnavailableError(
        `The counting engine failed: ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': /, "") : String(err)}`,
        err,
      );
    }
    return {
      imageWidth: raw.imageWidth,
      imageHeight: raw.imageHeight,
      pupae: raw.pupae,
      suspects: raw.suspects ?? [],
      sheet: raw.sheet ?? null,
      counts: raw.counts,
      yMin: raw.yMin,
      yMax: raw.yMax,
      imageDpi: raw.imageDpi ?? null,
      imageDpiSource: raw.imageDpiSource ?? null,
      trainDpi: raw.trainDpi ?? null,
      inferenceScale: raw.inferenceScale ?? null,
      modelVersion: raw.modelVersion,
      durationMs: Math.round(performance.now() - t0),
    };
  }
  return mockDetection(imagePath, opts.width ?? 1240, opts.height ?? 1753);
}

// ---- mock (browser preview / explicit opt-in) ------------------------------------

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function mockDetection(imagePath: string, w: number, h: number): Promise<DetectionResult> {
  const rand = mulberry32(Array.from(imagePath).reduce((a, c) => a + c.charCodeAt(0), 0));
  const n = 55 + Math.floor(rand() * 30);
  const cx = w * 0.5, top = h * 0.2, len = h * 0.6, half = w * 0.12;
  const raw: Pupa[] = [];
  for (let i = 0; i < n; i++) {
    raw.push({
      index: i + 1,
      x: Math.round(cx + (rand() - 0.5) * 2 * half),
      y: Math.round(top + Math.pow(rand(), 0.7) * len),
      rankPct: 0, band: "25-75%", source: "cnn",
    });
  }
  const corners: [number, number][] = [
    [cx - half - 20, top - 30], [cx + half + 20, top - 30],
    [cx + half + 20, top + len + 30], [cx - half - 20, top + len + 30],
  ];
  const pupae = recomputeRanks(raw, corners);
  const ys = pupae.map((p) => p.y);
  await new Promise((r) => setTimeout(r, 300));
  return {
    imageWidth: w, imageHeight: h, pupae, suspects: [],
    sheet: { found: true, corners, confidence: 0.3, method: "mock" },
    counts: {
      total: pupae.length,
      top5Pct: pupae.filter((p) => p.band === "0-5%").length,
      rank5To25: pupae.filter((p) => p.band === "5-25%").length,
      middle50: pupae.filter((p) => p.band === "25-75%").length,
      bottom25: pupae.filter((p) => p.band === "75-100%").length,
    },
    yMin: Math.min(...ys), yMax: Math.max(...ys),
    imageDpi: 150, imageDpiSource: "assumed", trainDpi: 150, inferenceScale: 1,
    modelVersion: "MOCK — synthetic data, not a real detection",
    durationMs: 300,
  };
}
