import React, { useEffect, useState } from "react";
import { Icons } from "./icons";
import { SessionPicker } from "./SessionPicker";
import { currentReplicate, useSessionStore } from "../store/sessionStore";
import { useSettings } from "../store/settingsStore";
import { useUi, type TabName } from "../store/uiStore";
import type { CnnInfo } from "../types";

const TABS: TabName[] = ["Scan", "Data", "Settings"];
const IS_MAC = navigator.platform.toLowerCase().includes("mac");

function timeAgo(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TopNav() {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  const save = useUi((s) => s.save);
  const rep = useSessionStore((s) => currentReplicate(s));
  const stage = useSessionStore((s) => s.stage);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const [cnn, setCnn] = useState<CnnInfo | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    window.pupa?.cnn.info().then((i) => alive && setCnn(i)).catch(() => alive && setCnn({ ready: false, error: "unavailable" }));
    const t = setInterval(() => tick((x) => x + 1), 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const nextTheme = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
  const engine = !window.pupa ? { cls: "warn", label: "Preview (no engine)" }
    : stage === "scanning" ? { cls: "busy", label: "Scanning…" }
    : stage === "detecting" ? { cls: "busy", label: "Counting…" }
    : cnn?.ready ? { cls: "good", label: `Model ready · ${cnn.trainDpi ?? "?"} DPI` }
    : cnn?.error ? { cls: "bad", label: "Model not running" }
    : { cls: "busy", label: "Starting model…" };
  const saved = save.state === "saving" ? { cls: "busy", label: "Saving…" }
    : save.state === "saved" && save.at ? { cls: "good", label: `Saved ${timeAgo(save.at)}` }
    : save.state === "error" ? { cls: "bad", label: "Save failed" }
    : null;

  return (
    <header className={`topbar${IS_MAC ? " mac" : ""}`}>
      <div className="brand"><span className="mark">{Icons.mark}</span>Pupa Counter<span className="ver">0.5</span></div>
      <nav className="nav" aria-label="Pages">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}>{t}</button>
        ))}
      </nav>
      <div className="context">
        <SessionPicker />
        <span className="rep-chip" title="Scans are saved into this replicate">Replicate <span className="n">{rep?.replicateNumber ?? 1}</span></span>
      </div>
      <div className="spacer" />
      <div className="statusline">
        {saved && <span title={save.path ?? save.error}><span className={`dot ${saved.cls}`} /> {saved.label}</span>}
        <span title={cnn?.error ?? cnn?.deviceName ?? ""}><span className={`dot ${engine.cls}`} /> {engine.label}</span>
      </div>
      <button className="iconbtn" onClick={() => setTheme(nextTheme)} title={`Theme: ${theme} (click for ${nextTheme})`}>
        {theme === "dark" ? Icons.moon : theme === "light" ? Icons.sun : Icons.monitor}
      </button>
    </header>
  );
}
