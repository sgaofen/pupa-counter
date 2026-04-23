import React, { useEffect, useState } from "react";
import { Icons } from "../components/icons";
import type { ScannerDevice } from "../types";
import { loadScannerSettings, saveScannerSettings } from "../adapters/scannerAdapter";
import { useSessionStore } from "../store/sessionStore";

const DPI_CHOICES = [200, 300, 400, 600];
const SAVE_DIR_KEY = "pupa.saveDir.v1";

export function SettingsView({ onToast }: { onToast: (msg: string) => void }) {
  const operator = useSessionStore((s) => s.session.operator);
  const setOperator = useSessionStore((s) => s.setOperator);

  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveDir, setSaveDir] = useState<string>(() => localStorage.getItem(SAVE_DIR_KEY) ?? "");

  const [devices, setDevices] = useState<ScannerDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [dpi, setDpi] = useState<number>(300);
  const [mode, setMode] = useState<"color" | "grayscale">("color");

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
    if (saveDir) localStorage.setItem(SAVE_DIR_KEY, saveDir);
    else localStorage.removeItem(SAVE_DIR_KEY);
    // operator edits flow live through setOperator → store → session.json,
    // so no extra persistence needed here.
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
              <div className="card-sub" style={{ marginTop: 2 }}>
                Loaded by the Python daemon at startup · v12 CNN + classifier v5
              </div>
            </div>
          </div>
          <div className="body">
            <div className="setting-row">
              <div>
                <div className="sr-label">Model file</div>
                <div className="sr-hint">
                  Managed by the daemon. Override by setting{" "}
                  <span className="mono">PUPA_DAEMON</span> /{" "}
                  <span className="mono">PUPA_PYTHON</span> env vars before launching the app.
                </div>
              </div>
              <div className="sr-control">
                <input
                  className="input mono"
                  readOnly
                  value="pupa_counter_v6/model/pupa_counter_v12.pt + peak_filter_clf.pkl"
                  style={{ fontSize: 11.5 }}
                />
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
              <div className="sr-control">
                <input
                  className="input"
                  value={operator}
                  onChange={(e) => setOperator(e.target.value)}
                  placeholder="Your name"
                />
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">Default save directory</div>
                <div className="sr-hint">
                  Remembered for future exports. Scans currently auto-save to{" "}
                  <span className="mono">%APPDATA%\pupa-counter-desktop\scans</span>.
                </div>
              </div>
              <div className="sr-control">
                <div className="file-chooser">
                  <input
                    className="input mono"
                    readOnly
                    value={saveDir}
                    placeholder="Not set"
                  />
                  <button className="btn" onClick={pickDir}>{Icons.folder} Choose…</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="s4-actions">
          <button className="btn btn-primary" onClick={handleSave}>
            {Icons.check} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
