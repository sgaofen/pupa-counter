// Workstation settings (per computer), kept in localStorage.
// Key names from v0.4 are reused so existing settings carry over.
import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";

export interface ScannerSettings {
  deviceId: string;
  dpi: number;
  mode: "color" | "grayscale";
}

export interface Overlays {
  bands: boolean;
  sheet: boolean;
  suspects: boolean;
  top5: boolean;
}

export const DEFAULT_GENOTYPES = [
  "Cage A", "Cage A-1", "Cage A-2", "Cage B", "Cage C", "w1118 control",
];

const K = {
  scanner: "pupa.scanner.settings.v1",
  saveDir: "pupa.saveDir.v1",
  exportDir: "pupa.exportDir.v1",
  genotypes: "pupa.genotypes.v1",
  defaultGenotype: "pupa.defaultGenotype.v1",
  theme: "pupa.theme.v1",
  overlays: "pupa.overlays.v1",
  operator: "pupa.defaultOperator.v1",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // v0.4 stored the save dir as a bare string, not JSON.
    try { return (localStorage.getItem(key) as unknown as T) ?? fallback; } catch { return fallback; }
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === "" || value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch { /* storage unavailable: settings last for this run only */ }
}
function readString(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}

interface SettingsState {
  scanner: ScannerSettings;
  saveDir: string;
  exportDir: string;
  genotypes: string[];
  defaultGenotype: string;
  defaultOperator: string;
  theme: ThemePref;
  overlays: Overlays;
  setScanner: (s: Partial<ScannerSettings>) => void;
  setSaveDir: (d: string) => void;
  setExportDir: (d: string) => void;
  setGenotypes: (g: string[]) => void;
  setDefaultGenotype: (g: string) => void;
  setDefaultOperator: (o: string) => void;
  setTheme: (t: ThemePref) => void;
  setOverlay: (k: keyof Overlays, v: boolean) => void;
}

/** Resolutions offered in the UI (150 = what the model is trained on). */
export const SCAN_DPIS = [150, 300, 600];
const initialScanner: ScannerSettings = {
  deviceId: "", dpi: 150, mode: "color",
  ...read<Partial<ScannerSettings>>(K.scanner, {}),
};
// Older versions offered 200 / 400 dpi; snap to the nearest choice so the
// pickers never show a value that isn't in their list.
if (!SCAN_DPIS.includes(initialScanner.dpi)) {
  const d = Number(initialScanner.dpi) || 150;
  initialScanner.dpi = SCAN_DPIS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));
}
const initialGenotypes = read<string[]>(K.genotypes, DEFAULT_GENOTYPES);

export const useSettings = create<SettingsState>((set, get) => ({
  scanner: initialScanner,
  saveDir: readString(K.saveDir),
  exportDir: readString(K.exportDir),
  genotypes: Array.isArray(initialGenotypes) && initialGenotypes.length ? initialGenotypes : DEFAULT_GENOTYPES,
  defaultGenotype: readString(K.defaultGenotype),
  defaultOperator: readString(K.operator),
  theme: (readString(K.theme) as ThemePref) || "system",
  overlays: { bands: true, sheet: true, suspects: true, top5: true, ...read<Partial<Overlays>>(K.overlays, {}) },

  setScanner: (s) => { const next = { ...get().scanner, ...s }; write(K.scanner, next); set({ scanner: next }); },
  setSaveDir: (d) => { write(K.saveDir, d); set({ saveDir: d }); },
  setExportDir: (d) => { write(K.exportDir, d); set({ exportDir: d }); },
  setGenotypes: (g) => {
    const clean = Array.from(new Set(g.map((x) => x.trim()).filter(Boolean)));
    write(K.genotypes, clean);
    set({ genotypes: clean });
  },
  setDefaultGenotype: (g) => { write(K.defaultGenotype, g); set({ defaultGenotype: g }); },
  setDefaultOperator: (o) => { write(K.operator, o); set({ defaultOperator: o }); },
  setTheme: (t) => { write(K.theme, t === "system" ? "" : t); set({ theme: t }); },
  setOverlay: (k, v) => { const next = { ...get().overlays, [k]: v }; write(K.overlays, next); set({ overlays: next }); },
}));

/** Genotype a fresh replicate starts with. */
export function startingGenotype(): string {
  const s = useSettings.getState();
  return s.defaultGenotype || s.genotypes[0] || "";
}
