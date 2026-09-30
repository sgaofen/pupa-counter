import React, { useEffect, useState } from "react";
import { Icons } from "./icons";
import { SessionPicker } from "./SessionPicker";
import type { SaveStatus, ToastTone } from "../App";

export type TabName = "Scan" | "Database" | "Settings";
const TABS: TabName[] = ["Scan", "Database", "Settings"];

interface Props {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  darkMode: boolean;
  onToggleDark: () => void;
  operatorInitials: string;
  onToast?: (msg: string, tone?: ToastTone) => void;
  save?: SaveStatus;
}

function savedLabel(s?: SaveStatus): string | null {
  if (!s || s.state === "idle") return null;
  if (s.state === "saving") return "Saving…";
  if (s.state === "error") return "Save failed";
  const sec = Math.round((Date.now() - (s.at ?? 0)) / 1000);
  if (sec < 10) return "Saved";
  return `Saved ${new Date(s.at!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function TopNav({ activeTab, onTabChange, darkMode, onToggleDark, operatorInitials, onToast, save }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 10000);
    return () => clearInterval(t);
  }, []);
  const label = savedLabel(save);
  return (
    <div className="topnav">
      <div className="brand">
        <div className="logo">{Icons.logo}</div>
        <div className="brandname">Pupa Counter</div>
        <span className="beta">Beta</span>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`tab ${activeTab === t ? "active" : ""}`}
            onClick={() => onTabChange(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="topnav-right">
        {label && (
          <span className={`save-status ${save?.state ?? ""}`} title={save?.error ?? "Session file is saved automatically after every change"}>
            <span className="dot" />{label}
          </span>
        )}
        <SessionPicker onToast={onToast} />
        <button className="iconbtn" title="Toggle theme" onClick={onToggleDark}>
          {darkMode ? Icons.sun : Icons.moon}
        </button>
        <div className="avatar" title="Operator">{operatorInitials}</div>
      </div>
    </div>
  );
}
