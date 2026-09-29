import React, { useEffect, useState } from "react";
import { Icons } from "../components/icons";
import type { AppPaths, CnnInfo, ScannerDevice } from "../types";
import { DEFAULT_GENOTYPES, useSettings, type ThemePref } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { useUi } from "../store/uiStore";
import { ShortcutList } from "../components/Shortcuts";

const DPI_CHOICES = [150, 300, 600];

export function SettingsView() {
  const st = useSettings();
  const operator = useSessionStore((s) => s.session.operator);
  const setOperator = useSessionStore((s) => s.setOperator);
  const toast = useUi((s) => s.toast);

  const [devices, setDevices] = useState<ScannerDevice[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [cnn, setCnn] = useState<CnnInfo | null>(null);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [newGeno, setNewGeno] = useState("");

  const probe = async () => {
    if (!window.pupa) { setProbeError("Scanner access needs the desktop app."); return; }
    setProbing(true);
    setProbeError(null);
    try {
      const list = await window.pupa.scanner.listDevices();
      setDevices(list);
      if (list.length && !list.some((d) => d.id === st.scanner.deviceId)) st.setScanner({ deviceId: list[0].id });
    } catch (err) {
      setProbeError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    probe();
    window.pupa?.cnn.info().then(setCnn).catch(() => setCnn(null));
    window.pupa?.app.paths().then(setPaths).catch(() => setPaths(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = !!devices && devices.length > 0;
  const trainDpi = cnn?.trainDpi ?? 150;
  const g = st.genotypes;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= g.length) return;
    const next = [...g];
    [next[i], next[j]] = [next[j], next[i]];
    st.setGenotypes(next);
  };

  return (
    <div className="page">
      <div className="settings">
        <div>
          <h1>Settings</h1>
          <p className="lead">These apply to this computer. Changes save as you make them.</p>
        </div>

        {/* Scanner */}
        <section className="set-sec">
          <header>
            <div>
              <h2>Scanner</h2>
              <p>{paths?.platform === "darwin" ? "macOS Image Capture" : "Windows WIA"} · Canon LiDE 300</p>
            </div>
            {probing ? <span className="pill accent"><span className="dot busy" />Looking…</span>
              : connected ? <span className="pill good"><span className="dot good" />Connected</span>
              : <span className="pill warn"><span className="dot warn" />Not found</span>}
          </header>
          <div className="set-row">
            <div><div className="l">Device</div><div className="h">Plug in the scanner, then check again.</div></div>
            <div className="c">
              <div className="inline">
                <select className="select" id="scanner-device" style={{ maxWidth: 360 }} value={st.scanner.deviceId}
                  onChange={(e) => st.setScanner({ deviceId: e.target.value })} disabled={!connected}>
                  {!connected && <option value="">No scanner found</option>}
                  {devices?.map((d) => <option key={d.id} value={d.id}>{d.name}{d.manufacturer ? ` · ${d.manufacturer}` : ""}</option>)}
                </select>
                <button className="btn" onClick={probe} disabled={probing}>{probing ? "Checking…" : "Check again"}</button>
              </div>
              {probeError && <div className="h" style={{ color: "var(--bad)" }}>{probeError}</div>}
            </div>
          </div>
          <div className="set-row">
            <div>
              <div className="l">Resolution</div>
              <div className="h">The model was trained on {trainDpi} DPI scans. Other resolutions are resized to {trainDpi} DPI before counting, so counts stay comparable; higher DPI keeps more detail in the saved image.</div>
            </div>
            <div className="c">
              <div className="seg" role="radiogroup" aria-label="Scan resolution">
                {DPI_CHOICES.map((d) => (
                  <button key={d} className={st.scanner.dpi === d ? "on" : ""} onClick={() => st.setScanner({ dpi: d })}>
                    {d} DPI{d === trainDpi ? " · model" : ""}
                  </button>
                ))}
              </div>
              <div className="h">The app now checks the DPI the scanner actually delivers and warns you if it differs.</div>
            </div>
          </div>
          <div className="set-row">
            <div><div className="l">Colour</div><div className="h">Colour matches the images the model was trained on.</div></div>
            <div className="c">
              <div className="seg" role="radiogroup" aria-label="Colour mode">
                {(["color", "grayscale"] as const).map((m) => (
                  <button key={m} className={st.scanner.mode === m ? "on" : ""} onClick={() => st.setScanner({ mode: m })}>
                    {m === "color" ? "Colour" : "Greyscale"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Genotypes */}
        <section className="set-sec">
          <header>
            <div><h2>Genotypes</h2><p>The buttons shown next to each scan. You can still type any other value on a scan.</p></div>
            <button className="btn btn-ghost btn-sm" onClick={() => st.setGenotypes(DEFAULT_GENOTYPES)}>Reset list</button>
          </header>
          <div className="set-row">
            <div><div className="l">List</div><div className="h">The first one (or the default below) is used when a new replicate starts.</div></div>
            <div className="c">
              <div className="geno-list">
                {g.map((name, i) => (
                  <div className="g" key={`${name}-${i}`}>
                    <input className="input" id={`geno-${i}`} defaultValue={name}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== name) { const n = [...g]; n[i] = v; st.setGenotypes(n); } }} />
                    <button className="iconbtn" title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                    <button className="iconbtn" title="Move down" onClick={() => move(i, 1)} disabled={i === g.length - 1}>▼</button>
                    <button className="iconbtn" title="Remove" onClick={() => st.setGenotypes(g.filter((_, k) => k !== i))}>{Icons.x}</button>
                  </div>
                ))}
              </div>
              <form className="inline" onSubmit={(e) => { e.preventDefault(); if (newGeno.trim()) { st.setGenotypes([...g, newGeno.trim()]); setNewGeno(""); } }}>
                <input className="input" id="geno-new" style={{ maxWidth: 260 }} placeholder="Add a genotype, e.g. Cage D" value={newGeno} onChange={(e) => setNewGeno(e.target.value)} />
                <button className="btn" type="submit" disabled={!newGeno.trim()}>{Icons.plus} Add</button>
              </form>
            </div>
          </div>
          <div className="set-row">
            <div><div className="l">Default for a new replicate</div></div>
            <div className="c">
              <select className="select" id="geno-default" style={{ maxWidth: 260 }} value={st.defaultGenotype} onChange={(e) => st.setDefaultGenotype(e.target.value)}>
                <option value="">First in the list ({g[0] ?? "none"})</option>
                {g.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Session defaults */}
        <section className="set-sec">
          <header><div><h2>Operator</h2><p>Used for this session and as the default for new sessions.</p></div></header>
          <div className="set-row">
            <div><div className="l">Name</div></div>
            <div className="c">
              <input className="input" id="operator" style={{ maxWidth: 320 }} value={operator}
                onChange={(e) => { setOperator(e.target.value); st.setDefaultOperator(e.target.value); }} placeholder="Your name" />
            </div>
          </div>
        </section>

        {/* Data & files */}
        <section className="set-sec">
          <header><div><h2>Data &amp; files</h2><p>Where your work is kept. Session files save automatically after every change.</p></div></header>
          <div className="set-row">
            <div><div className="l">Session data</div><div className="h">One JSON file per session. Copies of pre-v0.5 files are kept in a backup folder before they are first updated.</div></div>
            <div className="c">
              <div className="path">{paths?.sessions ?? "—"}</div>
              <div className="inline">
                <button className="btn btn-sm" onClick={() => paths && window.pupa?.shell.openPath(paths.sessions)} disabled={!paths}>{Icons.folder} Open folder</button>
              </div>
            </div>
          </div>
          <div className="set-row">
            <div><div className="l">Scanned images</div><div className="h">Each scan is saved here as a PNG.</div></div>
            <div className="c">
              <div className="path">{st.saveDir || paths?.scans || "—"}</div>
              <div className="inline">
                <button className="btn btn-sm" onClick={async () => { const d = await window.pupa?.dialog.openDirectory(); if (d) { st.setSaveDir(d); toast("Scan folder updated"); } }}>{Icons.folder} Choose…</button>
                <button className="btn btn-sm" onClick={() => window.pupa?.shell.openPath(st.saveDir || paths?.scans || "")} disabled={!paths}>Open</button>
                {st.saveDir && <button className="btn btn-sm btn-ghost" onClick={() => st.setSaveDir("")}>Use default</button>}
              </div>
            </div>
          </div>
          <div className="set-row">
            <div><div className="l">Exports</div><div className="h">CSV and Excel files from the Data page go here, and the folder opens after each export.</div></div>
            <div className="c">
              <div className="path">{st.exportDir || paths?.exportsDefault || "—"}</div>
              <div className="inline">
                <button className="btn btn-sm" onClick={async () => { const d = await window.pupa?.dialog.openDirectory(); if (d) { st.setExportDir(d); toast("Export folder updated"); } }}>{Icons.folder} Choose…</button>
                <button className="btn btn-sm" onClick={() => window.pupa?.shell.openPath(st.exportDir || paths?.exportsDefault || "")} disabled={!paths}>Open</button>
                {st.exportDir && <button className="btn btn-sm btn-ghost" onClick={() => st.setExportDir("")}>Use default</button>}
              </div>
            </div>
          </div>
        </section>

        {/* Model */}
        <section className="set-sec">
          <header>
            <div><h2>Counting model</h2><p>Loaded once when the app starts.</p></div>
            {cnn?.ready ? <span className="pill good"><span className="dot good" />Ready</span>
              : cnn?.error ? <span className="pill bad"><span className="dot bad" />Not running</span>
              : <span className="pill"><span className="dot busy" />Starting…</span>}
          </header>
          <div className="set-row"><div><div className="l">Model</div></div><div className="c"><div className="path">{cnn?.modelName ?? "—"} · {cnn?.model ?? ""}{cnn?.classifier ? ` + ${cnn.classifier}` : ""}</div></div></div>
          <div className="set-row"><div><div className="l">Training resolution</div><div className="h">From the model manifest; images at other DPIs are resized to this before counting.</div></div><div className="c"><div className="path">{cnn?.trainDpi ? `${cnn.trainDpi} DPI` : "—"}</div></div></div>
          <div className="set-row"><div><div className="l">Hardware</div></div><div className="c"><div className="path">{cnn?.deviceName ?? "—"}</div></div></div>
          <div className="set-row"><div><div className="l">Sheet detector</div></div><div className="c"><div className="path">{cnn?.sheetDetector === "stub" ? "Placeholder (outline fitted around the pupae — please confirm each one)" : cnn?.sheetDetector === "real" ? "Installed" : "—"}</div></div></div>
          {cnn?.error && <div className="set-row"><div><div className="l">Error</div></div><div className="c"><div className="path" style={{ color: "var(--bad)" }}>{cnn.error}</div></div></div>}
        </section>

        {/* Appearance */}
        <section className="set-sec">
          <header><div><h2>Appearance</h2></div></header>
          <div className="set-row">
            <div><div className="l">Theme</div><div className="h">System follows your computer's light / dark setting.</div></div>
            <div className="c">
              <div className="seg" role="radiogroup" aria-label="Theme">
                {(["system", "light", "dark"] as ThemePref[]).map((t) => (
                  <button key={t} className={st.theme === t ? "on" : ""} onClick={() => st.setTheme(t)}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="set-sec">
          <header><div><h2>Keyboard shortcuts</h2></div></header>
          <div className="set-row" style={{ gridTemplateColumns: "1fr" }}><ShortcutList /></div>
        </section>

        <p className="lead mono" style={{ fontSize: 11 }}>Pupa Counter {paths?.version ?? ""} · data folder {paths?.userData ?? ""}</p>
      </div>
    </div>
  );
}
