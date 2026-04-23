import React, { useEffect, useState } from "react";
import { Icons } from "../components/icons";
import type { ScannerDevice } from "../types";
import { loadScannerSettings, saveScannerSettings } from "../adapters/scannerAdapter";

const DPI_CHOICES = [200, 300, 400, 600];

export function SettingsView({ onToast }: { onToast: (msg: string) => void }) {
  const [gpu, setGpu] = useState<"Auto" | "CPU" | "CUDA" | "MPS">("Auto");
  const [testing, setTesting] = useState(false);
  const [threshold, setThreshold] = useState(62);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [saveDir, setSaveDir] = useState(
    "C:\\Sarah\\PupaCounter\\scans\\"
  );

  const [devices, setDevices] = useState<ScannerDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [dpi, setDpi] = useState<number>(300);
  const [mode, setMode] = useState<"color" | "grayscale">("color");
  const [refreshing, setRefreshing] = useState(false);

  // Load persisted scanner settings once, then probe for devices.
  useEffect(() => {
    const saved = loadScannerSettings();
    if (saved) {
      setSelectedDevice(saved.deviceId);
      setDpi(saved.dpi);
      setMode(saved.mode);
    }
    refreshDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshDevices = async () => {
    if (!window.pupa?.scanner) {
      onToast("Scanner IPC unavailable (browser preview)");
      return;
    }
    setRefreshing(true);
    try {
      const list = await window.pupa.scanner.listDevices();
      setDevices(list);
      if (list.length === 0) {
        onToast("No scanner detected");
      } else if (!list.find((d) => d.id === selectedDevice)) {
        // Auto-pick first device if previous selection is gone or none set.
        setSelectedDevice(list[0].id);
      }
    } catch (err) {
      onToast(`Scanner probe failed: ${(err as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    await refreshDevices();
    setTesting(false);
  };

  const pickDir = async () => {
    const p = await window.pupa?.dialog.openDirectory();
    if (p) setSaveDir(p);
  };

  const handleSave = () => {
    if (selectedDevice) saveScannerSettings({ deviceId: selectedDevice, dpi, mode });
    onToast("Settings saved");
  };

  const scannerConnected = devices.length > 0 && !!selectedDevice;

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
                  ? `WIA driver · ${devices.find((d) => d.id === selectedDevice)?.name ?? ""}`
                  : "Windows WIA — plug scanner and click Test connection"}
              </div>
            </div>
            <span className={`pill ${scannerConnected ? "good" : ""}`}>
              <span
                className="dot"
                style={scannerConnected ? undefined : { background: "var(--muted-2)" }}
              />
              {scannerConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="body">
            <div className="setting-row">
              <div>
                <div className="sr-label">Scanner device</div>
                <div className="sr-hint">WIA-enumerated devices on this machine.</div>
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
                <button className="btn" style={{ alignSelf: "flex-start" }} onClick={testConnection}>
                  {testing || refreshing ? "…Testing" : "Test connection"}
                </button>
              </div>
            </div>
            <div className={`setting-row ${scannerConnected ? "" : "disabled"}`}>
              <div>
                <div className="sr-label">Scan resolution</div>
                <div className="sr-hint">Model was trained at 300 DPI — keep as default unless you know better.</div>
              </div>
              <div className="sr-control">
                <select
                  className="select"
                  value={dpi}
                  onChange={(e) => setDpi(parseInt(e.target.value, 10))}
                  disabled={!scannerConnected}
                >
                  {DPI_CHOICES.map((n) => (
                    <option key={n} value={n}>{n} dpi</option>
                  ))}
                </select>
              </div>
            </div>
            <div className={`setting-row ${scannerConnected ? "" : "disabled"}`}>
              <div>
                <div className="sr-label">Color mode</div>
                <div className="sr-hint">Color matches the training distribution.</div>
              </div>
              <div className="sr-control">
                <div className="radio-group">
                  {(["color", "grayscale"] as const).map((x) => (
                    <label key={x} className={`radio ${mode === x ? "on" : ""}`}>
                      <input
                        type="radio"
                        name="scan-mode"
                        checked={mode === x}
                        onChange={() => setMode(x)}
                        disabled={!scannerConnected}
                      />
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
              <div className="card-title">Detection model</div>
              <div className="card-sub" style={{ marginTop: 2 }}>CNN · version v12 · mock</div>
            </div>
            <span className="pill good"><span className="dot" />Loaded (mock)</span>
          </div>
          <div className="body">
            <div className="setting-row">
              <div>
                <div className="sr-label">Model file</div>
                <div className="sr-hint">PyTorch .pt. Real Python subprocess will replace the mock next week.</div>
              </div>
              <div className="sr-control">
                <div className="file-chooser">
                  <input className="input mono" readOnly
                    defaultValue={"C:\\PupaCounter\\models\\pupa_v12.pt"} />
                  <button className="btn">{Icons.folder} Choose…</button>
                </div>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">GPU preference</div>
                <div className="sr-hint">Auto picks the fastest available backend.</div>
              </div>
              <div className="sr-control">
                <div className="radio-group">
                  {(["Auto", "CPU", "CUDA", "MPS"] as const).map((x) => (
                    <label key={x} className={`radio ${gpu === x ? "on" : ""}`}>
                      <input type="radio" name="gpu" checked={gpu === x} onChange={() => setGpu(x)} />{x}
                    </label>
                  ))}
                </div>
                <div className="hint mono">
                  {navigator.userAgent.includes("Mac") ? "Detected: Apple Silicon · MPS available" : "Detected: CUDA 12.1 · NVIDIA RTX A4000 · 16 GB"}
                </div>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Confidence threshold</div>
                <div className="sr-hint">Lower values detect more pupae, but more false positives.</div>
              </div>
              <div className="sr-control">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 56px", gap: 12, alignItems: "center" }}>
                  <input type="range" min={0} max={100} value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
                    style={{ accentColor: "var(--accent)" }} />
                  <span className="mono" style={{ color: "var(--ink)" }}>
                    {(threshold / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card setting-card">
          <div className="card-head">
            <div>
              <div className="card-title">Defaults</div>
              <div className="card-sub" style={{ marginTop: 2 }}>Used when starting a new session</div>
            </div>
          </div>
          <div className="body">
            <div className="setting-row">
              <div><div className="sr-label">Default operator</div></div>
              <div className="sr-control"><input className="input" defaultValue="Sarah Ruckman" /></div>
            </div>
            <div className="setting-row">
              <div><div className="sr-label">Default save directory</div></div>
              <div className="sr-control">
                <div className="file-chooser">
                  <input className="input mono" readOnly value={saveDir} />
                  <button className="btn" onClick={pickDir}>{Icons.folder} Choose…</button>
                </div>
              </div>
            </div>
            <div className="setting-row">
              <div><div className="sr-label">Starting round number</div></div>
              <div className="sr-control">
                <input className="input" defaultValue="1" style={{ width: 96, textAlign: "center" }} />
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Auto-advance image #</div>
                <div className="sr-hint">Increment image number after each save.</div>
              </div>
              <div className="sr-control">
                <div className={`switch ${autoAdvance ? "on" : ""}`} onClick={() => setAutoAdvance((v) => !v)} />
              </div>
            </div>
          </div>
        </div>

        <div className="s4-actions">
          <button className="btn">Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>
            {Icons.check} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
