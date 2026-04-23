import React, { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { TopNav, type TabName } from "./components/TopNav";
import { ScanView } from "./pages/ScanView";
import { DatabaseView } from "./pages/DatabaseView";
import { SettingsView } from "./pages/SettingsView";
import { useSessionStore } from "./store/sessionStore";

export function App() {
  const darkMode = useSessionStore((s) => s.darkMode);
  const toggleDark = useSessionStore((s) => s.toggleDark);
  const operator = useSessionStore((s) => s.session.operator);
  const initials = operator.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  const [tab, setTab] = useState<TabName>("Scan");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // ⌘S / ⌘P keyboard hooks (lightweight, no dependency).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "p") { e.preventDefault(); /* TODO: trigger process */ }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-root" data-theme={darkMode ? "dark" : "light"}>
      <TitleBar activeTab={tab} />
      <div className="app">
        <TopNav
          activeTab={tab}
          onTabChange={setTab}
          darkMode={darkMode}
          onToggleDark={toggleDark}
          operatorInitials={initials || "SR"}
        />
        {tab === "Scan" && <ScanView onNavigate={setTab} onToast={setToast} />}
        {tab === "Database" && <DatabaseView />}
        {tab === "Settings" && <SettingsView onToast={setToast} />}
      </div>
      {toast && (
        <div className="toast good">
          <span className="dot" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
