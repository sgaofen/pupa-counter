// Shared types across the renderer.
//
// Naming: the lab calls a batch of scans a "replicate". Session files on
// disk still use the v0.4 keys (`rounds`, `roundId`, `roundNumber`) so older
// installs can open them; src/lib/sessionSchema.ts converts between the two.

export type RankBand = "0-5%" | "5-25%" | "25-75%" | "75-100%";

export interface Pupa {
  index: number;            // 1-based within a scan
  x: number;                // pixel x in the original image
  y: number;                // pixel y in the original image
  rankPct: number;          // 0 = lowest pupa in the image (bottom), 100 = highest (top)
  band: RankBand;
  sheetPct?: number | null; // position along the sheet: 0 = sheet bottom end, 100 = top end
  score?: number;           // CNN heat at the peak (cnn points only)
  prob?: number | null;     // classifier P(real) (cnn points only)
  source: "cnn" | "manual";
}

export interface Suspect {
  x: number;
  y: number;
  score: number;
  prob: number | null;
  reason: "classifier-rejected" | "weak-signal" | string;
}

export type Corner = [number, number];

export interface SheetInfo {
  found: boolean;
  corners: Corner[];        // TL, TR, BR, BL (image pixels)
  angleDeg?: number;
  lengthPx?: number;
  widthPx?: number;
  truncatedTop?: boolean;
  truncatedBottom?: boolean;
  confidence?: number;
  method?: string;
  manual?: boolean;         // corners were adjusted by hand
  error?: string;
}

export interface ScanMeta {
  operator: string;
  experiment: string;
  genotype: string;
  comments: string;
  infoFilename: string;
}

export interface ScanRecord extends ScanMeta {
  id: string;
  replicateNumber: number;
  imageNumber: number;
  timestamp: string;
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  totalPupae: number;
  /** Count-based top 5 %: max(1, round(total × 0.05)) pupae with the lowest rank. */
  top5Selected: number;
  /** Position bands (rank 0–5 / 5–25 / 25–75 / 75–100 of the pupa y-range). */
  top5PctCount: number;
  rank5To25Count: number;
  middle50Count: number;
  bottom25Count: number;
  yMin: number | null;
  yMax: number | null;
  manuallyEdited: boolean;
  pupae: Pupa[];
  // v0.5 additions (absent on older records)
  requestedDpi?: number | null;
  actualDpi?: number | null;
  dpiSource?: string | null;
  trainDpi?: number | null;
  inferenceScale?: number | null;
  modelVersion?: string | null;
  sheet?: SheetInfo | null;
  /** Native 150-DPI scan the model analysed when the record image is a
   *  higher-DPI scan (pupae were copied over after alignment). */
  analysis?: AnalysisInfo | null;
  suspects?: Suspect[];
  cnnCount?: number;
}

export interface Replicate {
  replicateId: string;
  replicateNumber: number;
  startedAt: string;
  notes?: string;
  /** Metadata the next scan in this replicate starts with. */
  meta?: ScanMeta;
  scans: ScanRecord[];
}

export interface Session {
  sessionId: string;
  operator: string;
  experiment: string;
  startedAt: string;
  endedAt?: string;
  replicates: Replicate[];
}

export interface DetectionResult {
  imageWidth: number;
  imageHeight: number;
  pupae: Pupa[];
  suspects: Suspect[];
  sheet: SheetInfo | null;
  counts: {
    total: number;
    top5Pct: number;
    rank5To25: number;
    middle50: number;
    bottom25: number;
  };
  yMin: number | null;
  yMax: number | null;
  imageDpi: number | null;
  imageDpiSource: string | null;
  trainDpi: number | null;
  inferenceScale: number | null;
  analysis?: AnalysisInfo | null;
  modelVersion: string;
  durationMs: number;
}

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  operator: string;
  experiment: string;
  replicates: number;
  scans: number;
  mtimeMs: number;
}

export interface ScannerDevice {
  id: string;
  name: string;
  description: string;
  manufacturer: string;
}

export interface ScanParams {
  deviceId: string;
  dpi?: number;
  mode?: "color" | "grayscale";
  outDir?: string;
}

export interface AnalysisInfo {
  path: string;
  width: number;
  height: number;
  dpi?: number | null;
  scale?: [number, number];
  shiftPx?: [number, number];
  alignResponse?: number;
  warning?: string | null;
}

export interface ScanResult {
  ok: true;
  path: string;
  width: number;
  height: number;
  requestedDpi: number;
  actualDpi: number | null;
  dpiSource?: string;
  mode: "color" | "grayscale";
  warnings?: string[];
  backend?: string;
  analysis?: { path: string; width: number; height: number; actualDpi: number | null } | null;
}

export interface CnnInfo {
  ready: boolean;
  error?: string;
  device?: string;
  deviceName?: string;
  model?: string;
  modelName?: string;
  classifier?: string | null;
  trainDpi?: number;
  manifest?: string;
  sheetDetector?: "stub" | "real" | null;
}

export interface AppPaths {
  userData: string;
  sessions: string;
  sessionBackups: string;
  scans: string;
  exportsDefault: string;
  platform: string;
  version: string;
}

export interface XlsxSheet {
  name: string;
  header: string[];
  rows: (string | number | boolean | null)[][];
}

// Preload-exposed API (see electron/preload.js).
declare global {
  interface Window {
    pupa?: {
      session: {
        load: (sessionId?: string) => Promise<unknown | null>;
        save: (data: unknown) => Promise<{ ok: boolean; path: string; savedAt: number }>;
        list: () => Promise<SessionSummary[]>;
        create: (partial?: Partial<Session>) => Promise<unknown>;
        delete: (sessionId: string) => Promise<boolean>;
      };
      dialog: {
        openImage: () => Promise<string | null>;
        openDirectory: () => Promise<string | null>;
      };
      file: {
        readImageDataUrl: (path: string) => Promise<string>;
        exists: (path: string) => Promise<boolean>;
        listDemoScans: () => Promise<string[]>;
        pathForFile: (file: File) => string;
      };
      cnn: {
        detect: (imagePath: string, opts?: { dpi?: number | null; analysisPath?: string | null; analysisDpi?: number | null }) => Promise<any>;
        info: () => Promise<CnnInfo | null>;
      };
      scanner: {
        listDevices: () => Promise<ScannerDevice[]>;
        scan: (params: ScanParams) => Promise<ScanResult>;
      };
      exporter: {
        text: (args: { dir?: string; filename: string; content: string; bom?: boolean }) => Promise<string>;
        xlsx: (args: { dir?: string; filename: string; sheets: XlsxSheet[] }) => Promise<string>;
      };
      shell: {
        showItemInFolder: (p: string) => Promise<boolean>;
        openPath: (p: string) => Promise<string>;
      };
      app: {
        paths: () => Promise<AppPaths>;
      };
    };
    __pupaDebug?: Record<string, unknown>;
  }
}
