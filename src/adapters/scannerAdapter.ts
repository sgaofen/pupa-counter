/**
 * Scanner adapter. Windows drives WIA, macOS drives ImageCaptureCore (both
 * in the main process). Outside Electron it falls back to a file picker so
 * the rest of the UI still works.
 */
import { useSettings } from "../store/settingsStore";

export interface ScanHandle {
  path: string;
  dataUrl: string;
  width: number;
  height: number;
  requestedDpi?: number | null;
  actualDpi?: number | null;
  dpiSource?: string | null;
  warnings?: string[];
}

export class NoScannerError extends Error {
  constructor() {
    super("No scanner found. Check the USB cable and power, then try again — or use Import to open an image file.");
    this.name = "NoScannerError";
  }
}

export async function scanNow(): Promise<ScanHandle | null> {
  if (!window.pupa) return browserFilePicker();
  const settings = useSettings.getState();
  let deviceId = settings.scanner.deviceId;

  // Saved IDs go stale across re-plugs and driver swaps: check against the
  // live list and fall back to the first scanner found.
  const list = await window.pupa.scanner.listDevices();
  if (!deviceId || !list.some((d) => d.id === deviceId)) {
    if (list.length === 0) throw new NoScannerError();
    deviceId = list[0].id;
    settings.setScanner({ deviceId });
  }

  const result = await window.pupa.scanner.scan({
    deviceId,
    dpi: settings.scanner.dpi,
    mode: settings.scanner.mode,
    outDir: settings.saveDir || undefined,
  });
  const dataUrl = await window.pupa.file.readImageDataUrl(result.path);
  return {
    path: result.path,
    dataUrl,
    width: result.width,
    height: result.height,
    requestedDpi: result.requestedDpi,
    actualDpi: result.actualDpi,
    dpiSource: result.dpiSource ?? "scanner",
    warnings: result.warnings ?? [],
  };
}

export async function loadScanFromPath(path: string): Promise<ScanHandle | null> {
  if (!window.pupa) return null;
  const dataUrl = await window.pupa.file.readImageDataUrl(path);
  const dims = await getImageDims(dataUrl);
  return { path, dataUrl, ...dims };
}

export async function pickImageFile(): Promise<ScanHandle | null> {
  if (!window.pupa) return browserFilePicker();
  const path = await window.pupa.dialog.openImage();
  if (!path) return null;
  return loadScanFromPath(path);
}

export async function listDemoScans(): Promise<string[]> {
  return window.pupa ? window.pupa.file.listDemoScans() : [];
}

export function getImageDims(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

function browserFilePicker(): Promise<ScanHandle | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const url = URL.createObjectURL(f);
      const dims = await getImageDims(url);
      resolve({ path: f.name, dataUrl: url, ...dims });
    };
    input.click();
  });
}
