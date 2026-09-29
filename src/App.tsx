import React, { useEffect, useRef, useState } from "react";
import { TopNav } from "./components/TopNav";
import { ShortcutsModal } from "./components/Shortcuts";
import { ScanView } from "./pages/ScanView";
import { DatabaseView } from "./pages/DatabaseView";
import { SettingsView } from "./pages/SettingsView";
import { useSessionStore } from "./store/sessionStore";
import { useSettings } from "./store/settingsStore";
import { useUi } from "./store/uiStore";
import { serializeSession } from "./lib/sessionSchema";

export function App() {
  const tab = useUi((s) => s.tab);
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  const theme = useSettings((s) => s.theme);
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Theme: explicit choice sets data-theme on <html>; "system" leaves it
  // unset so prefers-color-scheme decides.
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", theme);
  }, [theme]);

  // Load the most recent session (or create the first one).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const st = useSessionStore.getState();
      try {
        if (!window.pupa) {
          st.loadSession({ sessionId: "browser-preview", operator: "", experiment: "", startedAt: "", rounds: [] });
        } else {
          let raw = await window.pupa.session.load();
          if (!raw || !st.loadSession(raw)) {
            raw = await window.pupa.session.create({ operator: useSettings.getState().defaultOperator });
            st.loadSession(raw);
          }
        }
      } catch (err) {
        console.warn("[session] load failed:", err);
        useUi.getState().toast(`Could not open the last session: ${String(err)}`, "bad");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-save: every change to the session is written (debounced) to
  // <userData>/sessions/<id>.json. Nothing is written before hydration.
  useEffect(() => {
    if (!hydrated || !window.pupa) return;
    const flush = async (session = useSessionStore.getState().session) => {
      if (!session.sessionId) return;
      useUi.getState().setSave({ state: "saving" });
      try {
        const res = await window.pupa!.session.save(serializeSession(session));
        useUi.getState().setSave({ state: "saved", at: res?.savedAt ?? Date.now(), path: res?.path });
      } catch (err) {
        useUi.getState().setSave({ state: "error", error: String(err) });
        useUi.getState().toast(`Saving failed: ${String(err)}`, "bad");
      }
    };
    const unsub = useSessionStore.subscribe((state, prev) => {
      if (state.session === prev.session) return;
      if (state.session.sessionId !== prev.session.sessionId) return; // switching sessions, not editing
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      useUi.getState().setSave({ state: "saving" });
      saveTimer.current = window.setTimeout(() => flush(), 250);
    });
    const onUnload = () => { if (saveTimer.current) { window.clearTimeout(saveTimer.current); flush(); } };
    window.addEventListener("beforeunload", onUnload);
    return () => { unsub(); window.removeEventListener("beforeunload", onUnload); };
  }, [hydrated]);

  // Test hook for the screenshot tour.
  useEffect(() => {
    window.__pupaDebug = {
      ...(window.__pupaDebug ?? {}),
      setTab: (t: "Scan" | "Data" | "Settings") => useUi.getState().setTab(t),
      setTheme: (t: "system" | "light" | "dark") => useSettings.getState().setTheme(t),
      state: () => {
        const s = useSessionStore.getState();
        return { sessionId: s.session.sessionId, replicates: s.session.replicates.map((r) => ({ n: r.replicateNumber, scans: r.scans.length })), stage: s.stage, error: s.error, work: s.work ? { total: s.work.record.totalPupae, dpi: s.work.record.actualDpi, sheet: s.work.record.sheet } : null };
      },
    };
  }, []);

  return (
    <div className="app">
      <TopNav />
      {!hydrated ? (
        <div className="page" />
      ) : tab === "Scan" ? <ScanView /> : tab === "Data" ? <DatabaseView /> : <SettingsView />}
      <ShortcutsModal />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="dot" />
            <span>{t.msg}</span>
            {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
