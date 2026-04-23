import React, { useState } from "react";
import { Icons } from "../components/icons";

export function SettingsView({ onToast }: { onToast: (msg: string) => void }) {
  const [gpu, setGpu] = useState<"Auto" | "CPU" | "CUDA" | "MPS">("Auto");
  const [testing, setTesting] = useState(false);
  const [threshold, setThreshold] = useState(62);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [saveDir, setSaveDir] = useState(
    "C:\\Sarah\\PupaCounter\\scans\\"
  );

  const pickDir = async () => {
    const p = await window.pupa?.dialog.openDirectory();
    if (p) setSaveDir(p);
  };

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
              <div className="card-sub" style={{ marginTop: 2 }}>Pending driver integration · TWAIN on Win, ICA on macOS</div>
            </div>
            <span className="pill"><span className="dot" style={{ background: "var(--muted-2)" }} />Disconnected</span>
          </div>
          <div className="body">
            <div className="setting-row">
              <div>
                <div className="sr-label">Scanner device</div>
                <div className="sr-hint">Auto-detected devices listed first.</div>
              </div>
              <div className="sr-control">
                <select className="select" defaultValue="No scanner connected">
                  <option>No scanner connected</option>
                  <option>EPSON Perfection V600 (USB)</option>
                  <option>Canon CanoScan 9000F</option>
                </select>
                <button className="btn"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => { setTesting(true); setTimeout(() => { setTesting(false); onToast("No device detected"); }, 900); }}>
                  {testing ? "…Testing" : "Test connection"}
                </button>
              </div>
            </div>
            <div className="setting-row disabled">
              <div>
                <div className="sr-label">Scan resolution</div>
                <div className="sr-hint">Requires a connected scanner.</div>
              </div>
              <div className="sr-control">
                <select className="select" defaultValue="1200 dpi">
                  <option>600 dpi</option><option>1200 dpi</option><option>2400 dpi</option>
                </select>
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
          <button className="btn btn-primary" onClick={() => onToast("Settings saved")}>
            {Icons.check} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
