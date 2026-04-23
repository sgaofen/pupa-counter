/**
 * Scanner adapter.
 *
 * ⚠️  MOCK — opens the native file picker instead of driving a real
 *     scanner. Replace once the physical scanner arrives. Keep this
 *     interface stable so the rest of the UI doesn't need to change.
 */
export interface ScanHandle {
  path: string;
  dataUrl: string;
  width: number;
  height: number;
}

export async function scanNow(): Promise<ScanHandle | null> {
  if (!window.pupa) {
    return await browserFilePicker();
  }
  const path = await window.pupa.dialog.openImage();
  if (!path) return null;
  const dataUrl = await window.pupa.file.readImageDataUrl(path);
  const dims = await getImageDims(dataUrl);
  return { path, dataUrl, ...dims };
}

/** Load a specific file by path (used by "Load demo scan" button). */
export async function loadScanFromPath(path: string): Promise<ScanHandle | null> {
  if (!window.pupa) return null;
  const dataUrl = await window.pupa.file.readImageDataUrl(path);
  const dims = await getImageDims(dataUrl);
  return { path, dataUrl, ...dims };
}

export async function listDemoScans(): Promise<string[]> {
  return window.pupa ? await window.pupa.file.listDemoScans() : [];
}

function getImageDims(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 1116, height: 2586 });
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
