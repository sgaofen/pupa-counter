// Shared types across renderer.

export type RankBand = "0-5%" | "5-25%" | "25-75%" | "75-100%";

export interface Pupa {
  index: number;       // 1-based within a scan
  x: number;           // pixel x
  y: number;           // pixel y
  rankPct: number;     // 0 = image bottom, 100 = image top
  band: RankBand;
  source: "cnn" | "manual";
}

export interface ScanRecord {
  id: string;                 // e.g. "s_013"
  roundNumber: number;
  imageNumber: number;
  timestamp: string;          // ISO-8601
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  experiment: string;
  operator: string;
  genotype: string;
  comments: string;
  infoFilename: string;
  totalPupae: number;
  top5PctCount: number;
  rank5To25Count: number;
  middle50Count: number;
  bottom25Count: number;
  yMin: number;
  yMax: number;
  manuallyEdited: boolean;
  pupae: Pupa[];
}

export interface Round {
  roundId: string;
  roundNumber: number;
  startedAt: string;
  notes?: string;
  scans: ScanRecord[];
}

export interface Session {
  sessionId: string;
  operator: string;
  experiment: string;
  startedAt: string;
  endedAt?: string;
  rounds: Round[];
}

export interface DetectionResult {
  imageWidth: number;
  imageHeight: number;
  pupae: Pupa[];
  counts: {
    total: number;
    top5Pct: number;
    rank5To25: number;
    middle50: number;
    bottom25: number;
  };
  yMin: number;
  yMax: number;
  modelVersion: string;
  durationMs: number;
}

// Preload-exposed API (see electron/preload.js).
declare global {
  interface Window {
    pupa?: {
      session: {
        load: () => Promise<Session | null>;
        save: (data: Session) => Promise<boolean>;
      };
      dialog: {
        openImage: () => Promise<string | null>;
        openDirectory: () => Promise<string | null>;
      };
      file: {
        readImageDataUrl: (path: string) => Promise<string>;
        listDemoScans: () => Promise<string[]>;
      };
      cnn: {
        detect: (imagePath: string) => Promise<{
          imagePath: string;
          imageWidth: number;
          imageHeight: number;
          modelVersion: string;
          pupae: Pupa[];
          counts: {
            total: number;
            top5Pct: number;
            rank5To25: number;
            middle50: number;
            bottom25: number;
          };
          yMin: number;
          yMax: number;
        }>;
      };
      scanner: {
        listDevices: () => Promise<ScannerDevice[]>;
        scan: (params: ScanParams) => Promise<ScanResult>;
      };
    };
  }
}

export interface ScannerDevice {
  id: string;
  name: string;
  description: string;
  manufacturer: string;
}

export interface ScanParams {
  deviceId: string;
  dpi?: number;                       // default 300
  mode?: "color" | "grayscale";       // default "color"
  outDir?: string;                    // absolute dir; main.js falls back to userData/scans
}

export interface ScanResult {
  ok: true;
  path: string;
  width: number;
  height: number;
  dpi: number;
  mode: "color" | "grayscale";
}
