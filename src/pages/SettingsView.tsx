import React, { useEffect, useState } from "react";
import { Icons } from "../components/icons";
import type { AppPaths, ScannerDevice, CnnInfo } from "../types";
import { DEFAULT_GENOTYPES, useSettings } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import type { ToastTone } from "../App";

// Same choices as the picker next to "New scan" on the Scan page.
const DPI_CHOICES = [150, 300, 600];

// Unsaved edits on this page, so App can ask before the user navigates away.
let settingsDirty = false;
export const isSettingsDirty = () => settingsDirty;

/** Read-only path fields: show the end (folder name), not the start. */
function scrollToEnd(el: HTMLInputElement | null) {
  if (el) requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth; });
}

function cleanError(err: unknown) {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export function SettingsView({ onToast }: { onToast: (msg: string, tone?: ToastTone) => void }) {
  const operator = useSessionStore((s) => s.session.operator);
  const setOperator = useSessionStore((s) => s.setOperator);
  const settings = useSettings();

  const [refreshing, setRefreshing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [saveDir, setSaveDir] = useState<string>(settings.saveDir);
  const [exportDir, setExportDir] = useState<string>(settings.exportDir);
  const [devices, setDevices] = useState<ScannerDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>(settings.scanner.deviceId);
  const [dpi, setDpi] = useState<number>(settings.scanner.dpi);
  const [mode, setMode] = useState<"color" | "grayscale">(settings.scanner.mode);
  const [genotypes, setGenotypes] = useState<string[]>(settings.genotypes);
  const [newGenotype, setNewGenotype] = useState("");
  const [cnnInfo, setCnnInfo] = useState<CnnInfo | null>(null);
  const [paths, setPaths] = useState<AppPaths | null>(null);

  useEffect(() => {
    refreshDevices(false);
    // Pre-warmed at window boot, so this is near-instant in the common case.
    window.pupa?.cnn?.info().then(setCnnInfo).catch(() => setCnnInfo(null));
    window.pupa?.app?.paths().then(setPaths).catch(() => setPaths(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshDevices = async (announce = true) => {
    if (!window.pupa?.scanner) {
      setProbeError("Scanner access needs the desktop app.");
      return;
    }
    setRefreshing(true);
    setProbeError(null);
    try {
      const list = await window.pupa.scanner.listDevices();
      setDevices(list);
      if (list.length === 0) {
        if (announce) onToast("No scanner detected — check the USB cable and power", "warn");
      } else {
        if (!list.find((d) => d.id === selectedDevice)) {
          // Saved scanner missing (first run, or re-plugged): use the first one
          // found and remember it, so just opening Settings isn't an "unsaved change".
          setSelectedDevice(list[0].id);
          settings.setScanner({ deviceId: list[0].id });
        }
        if (announce) onToast(`Found ${list[0].name}`);
      }
    } catch (err) {
      setProbeError(cleanError(err));
      if (announce) onToast(`Scanner check failed — ${cleanError(err)}`, "bad");
    } finally {
      setRefreshing(false);
    }
  };

  const pickDir = async (set: (d: string) => void) => {
    const p = await window.pupa?.dialog.openDirectory();
    if (p) set(p);
  };

  const dirty =
    saveDir !== settings.saveDir || exportDir !== settings.exportDir ||
    dpi !== settings.scanner.dpi || mode !== settings.scanner.mode ||
    selectedDevice !== settings.scanner.deviceId ||
    JSON.stringify(genotypes) !== JSON.stringify(settings.genotypes);

  useEffect(() => {
    settingsDirty = dirty;
    return () => { settingsDirty = false; };
  }, [dirty]);

  const handleSave = () => {
    settings.setScanner({ deviceId: selectedDevice, dpi, mode });
    settings.setSaveDir(saveDir);
    settings.setExportDir(exportDir);
    settings.setGenotypes(genotypes);
    setGenotypes(useSettings.getState().genotypes);
    onToast("Settings saved");
  };

  const moveGenotype = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= genotypes.length) return;
    const next = [...genotypes];
    [next[i], next[j]] = [next[j], next[i]];
    setGenotypes(next);
  };
  const addGenotype = () => {
    const v = newGenotype.trim();
    if (!v) return;
    if (!genotypes.includes(v)) setGenotypes([...genotypes, v]);
    setNewGenotype("");
  };

  const scannerConnected = devices.length > 0 && !!selectedDevice;
  const isMac = paths?.platform === "darwin";
  const trainDpi = cnnInfo?.trainDpi ?? 150;

  return (
    <div className="s4-body">
      <div className="s4-inner">
        <div className="s4-head">
          <h1>Settings</h1>
          <p>Hardware, model, and default values for this workstation.</p>
        </div>

        <div className="card setting-card">
          <div className="card-head">
            <div>
              <div className="card-title">Scanner</div>
              <div className="card-sub" style={{ marginTop: 2 }}>
                {scannerConnected
                  ? `${isMac ? "Image Capture" : "WIA driver"} · ${devices.find((d) => d.id === selectedDevice)?.name ?? ""}`
                  : `${isMac ? "macOS Image Capture" : "Windows WIA"} — plug in the scanner and click Test connection`}
              </div>
            </div>
            <span className={`pill ${refreshing ? "accent" : scannerConnected ? "good" : ""}`}>
              <span className="dot" style={scannerConnected || refreshing ? undefined : { background: "var(--muted-2)" }} />
              {refreshing ? "Checking…" : scannerConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="body">
            <div className="setting-row">
              <div>
                <div className="sr-label">Scanner device</div>
                <div className="sr-hint">{isMac ? "Scanners visible to Image Capture." : "WIA-enumerated devices on this machine."}</div>
              </div>
              <div className="sr-control">
                <select
                  className="select"
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  disabled={devices.length === 0}
                >
                  {devices.length === 0 && <option value="">No scanner connected</option>}
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.manufacturer ? ` · ${d.manufacturer}` : ""}
                    </option>
                  ))}
                </select>
                <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => refreshDevices(true)} disabled={refreshing}>
                  {refreshing ? "Testing…" : "Test connection"}
                </button>
                {probeError && <div className="sr-hint" style={{ color: "var(--bad)" }}>{probeError}</div>}
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Scan resolution</div>
                <div className="sr-hint">
                  Counting always runs on a native {trainDpi} DPI scan (what the model was trained on). Choosing 300 or 600 DPI
                  scans twice — {trainDpi} DPI for counting, then the higher resolution for the saved image — so counts stay
                  comparable. Also available next to <b>New scan</b>.
                </div>
              </div>
              <div className="sr-control">
                <select className="select" value={dpi} onChange={(e) => setDpi(parseInt(e.target.value, 10))}>
                  {DPI_CHOICES.map((n) => (
                    <option key={n} value={n}>{n} dpi{n === trainDpi ? " (model training resolution)" : " (two passes)"}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Color mode</div>
                <div className="sr-hint">Color matches the training distribution.</div>
              </div>
              <div className="sr-control">
                <div className="radio-group">
                  {(["color", "grayscale"] as const).map((x) => (
                    <label key={x} className={`radio ${mode === x ? "on" : ""}`}>
                      <input type="radio" name="scan-mode" checked={mode === x} onChange={() => setMode(x)} />
                      {x === "color" ? "Color" : "Grayscale"}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card setting-card">
          <div className="card-head">
            <div>
              <div className="card-title">Genotypes</div>
              <div className="card-sub" style={{ marginTop: 2 }}>Choices in the Genotype menu on the Scan page</div>
            </div>
            <button className="btn btn-ghost" onClick={() => setGenotypes(DEFAULT_GENOTYPES)}>Reset to defaults</button>
          </div>
          <div className="body">
            <div className="setting-row">
              <div>
                <div className="sr-label">List</div>
                <div className="sr-hint">Rename, reorder or remove. "Other…" on the Scan page still lets you type anything.</div>
              </div>
              <div className="sr-control">
                <div className="geno-list">
                  {genotypes.map((g, i) => (
                    <div className="geno-row" key={`${i}-${g}`}>
                      <input className="input" defaultValue={g}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== g) { const n = [...genotypes]; n[i] = v; setGenotypes(n); }
                        }} />
                      <button className="iconbtn" title="Move up" onClick={() => moveGenotype(i, -1)} disabled={i === 0}>↑</button>
                      <button className="iconbtn" title="Move down" onClick={() => moveGenotype(i, 1)} disabled={i === genotypes.length - 1}>↓</button>
                      <button className="iconbtn" title="Remove" onClick={() => setGenotypes(genotypes.filter((_, k) => k !== i))}>{Icons.x}</button>
                    </div>
                  ))}
                </div>
                <div className="file-chooser">
                  <input className="input" placeholder="Add a genotype, e.g. Cage D" value={newGenotype}
                    onChange={(e) => setNewGenotype(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addGenotype(); }} />
                  <button className="btn" onClick={addGenotype} disabled={!newGenotype.trim()}>{Icons.plus} Add</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card setting-card">
          <div className="card-head">
            <div>
              <div className="card-title">Detection model</div>
              <div className="card-sub" style={{ marginTop: 2 }}>
                Loaded by the Python daemon at startup{cnnInfo?.modelName ? ` · ${cnnInfo.modelName}` : ""}
              </div>
            </div>
            {cnnInfo?.ready ? (
              <span className="pill good"><span className="dot" />Daemon ready</span>
            ) : cnnInfo?.error ? (
              <span className="pill bad" title={cnnInfo.error}><span className="dot" />Daemon not running</span>
            ) : (
              <span className="pill"><span className="dot" style={{ background: "var(--muted-2)" }} />Starting…</span>
            )}
          </div>
          <div className="body">
            <div className="setting-row">
              <div>
                <div className="sr-label">Hardware acceleration</div>
                <div className="sr-hint">
                  Auto-detected at daemon startup. Install a GPU-capable torch wheel with{" "}
                  <span className="mono">daemon/scripts/setup_venv.py</span> on each new machine.
                </div>
              </div>
              <div className="sr-control">
                <input className="input mono" readOnly value={cnnInfo?.deviceName ?? (cnnInfo?.error ? "—" : "(daemon still warming up…)")} style={{ fontSize: 11.5 }} />
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Model file</div>
                <div className="sr-hint">
                  Chosen by <span className="mono">model/manifest.json</span>; override with{" "}
                  <span className="mono">PUPA_MODEL_PATH</span> / <span className="mono">PUPA_PYTHON</span>.
                </div>
              </div>
              <div className="sr-control">
                <input className="input mono" readOnly style={{ fontSize: 11.5 }}
                  value={cnnInfo?.model ? `${cnnInfo.model}${cnnInfo.classifier ? " + " + cnnInfo.classifier : ""}` : "—"} />
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Training resolution</div>
                <div className="sr-hint">Images at another DPI are resized to this before counting; coordinates stay in original pixels.</div>
              </div>
              <div className="sr-control">
                <input className="input mono" readOnly style={{ fontSize: 11.5 }} value={cnnInfo?.trainDpi ? `${cnnInfo.trainDpi} dpi` : "—"} />
              </div>
            </div>
            <div className="setting-row">
              <div><div className="sr-label">Sheet detector</div></div>
              <div className="sr-control">
                <input className="input mono" readOnly style={{ fontSize: 11.5 }}
                  value={cnnInfo?.sheetDetector === "real" ? "sheet_detect.py (installed)" : cnnInfo?.sheetDetector === "stub" ? "placeholder" : "—"} />
              </div>
            </div>
            {cnnInfo?.error && (
              <div className="setting-row">
                <div><div className="sr-label">Error</div></div>
                <div className="sr-control"><div className="sr-hint mono" style={{ color: "var(--bad)" }}>{cnnInfo.error}</div></div>
              </div>
            )}
          </div>
        </div>

        <div className="card setting-card">
          <div className="card-head">
            <div>
              <div className="card-title">Defaults &amp; data</div>
              <div className="card-sub" style={{ marginTop: 2 }}>Where scans, sessions and exports are kept</div>
            </div>
          </div>
          <div className="body">
            <div className="setting-row">
              <div><div className="sr-label">Default operator</div></div>
              <div className="sr-control">
                <input className="input" value={operator}
                  onChange={(e) => { setOperator(e.target.value); settings.setDefaultOperator(e.target.value); }}
                  placeholder="Your name" />
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Session data</div>
                <div className="sr-hint">One JSON file per session, saved automatically. Pre-v0.5 files are backed up before they are first updated.</div>
              </div>
              <div className="sr-control">
                <div className="file-chooser">
                  <input className="input mono" readOnly value={paths?.sessions ?? "—"} title={paths?.sessions} ref={(el) => scrollToEnd(el)} style={{ fontSize: 11.5 }} />
                  <button className="btn" onClick={() => paths && window.pupa?.shell.openPath(paths.sessions)} disabled={!paths}>{Icons.folder} Open</button>
                </div>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Scan save directory</div>
                <div className="sr-hint">Every new scan lands here. Unset → Documents/Pupa Counter Scans; if the folder can't be written, the app's data folder is used.</div>
              </div>
              <div className="sr-control">
                <div className="file-chooser three">
                  <input className="input mono" readOnly value={saveDir || paths?.scans || ""} placeholder="(default)" title={saveDir || paths?.scans} ref={(el) => scrollToEnd(el)} style={{ fontSize: 11.5, color: saveDir ? undefined : "var(--muted)" }} />
                  <button className="btn" onClick={() => pickDir(setSaveDir)}>{Icons.folder} Choose…</button>
                  <button className="btn" onClick={() => window.pupa?.shell.openPath(saveDir || paths?.scans || "")} disabled={!paths}>Open</button>
                </div>
                {saveDir && <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSaveDir("")}>{Icons.x} Use default</button>}
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Export directory</div>
                <div className="sr-hint">CSV / Excel files from the Database page. The folder opens after each export.</div>
              </div>
              <div className="sr-control">
                <div className="file-chooser three">
                  <input className="input mono" readOnly value={exportDir || paths?.exportsDefault || ""} placeholder="(default)" title={exportDir || paths?.exportsDefault} ref={(el) => scrollToEnd(el)} style={{ fontSize: 11.5, color: exportDir ? undefined : "var(--muted)" }} />
                  <button className="btn" onClick={() => pickDir(setExportDir)}>{Icons.folder} Choose…</button>
                  <button className="btn" onClick={() => window.pupa?.shell.openPath(exportDir || paths?.exportsDefault || "")} disabled={!paths}>Open</button>
                </div>
                {exportDir && <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setExportDir("")}>{Icons.x} Use default</button>}
              </div>
            </div>
          </div>
        </div>

        <div className={`s4-actions${dirty ? " dirty" : ""}`}>
          {dirty && <span className="hint" style={{ alignSelf: "center" }}>Unsaved changes</span>}
          <button className="btn btn-primary" onClick={handleSave} disabled={!dirty}>
            {Icons.check} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
