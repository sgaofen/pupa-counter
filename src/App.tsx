import React, { useEffect, useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { TopNav, type TabName } from "./components/TopNav";
import { ScanView } from "./pages/ScanView";
import { DatabaseView } from "./pages/DatabaseView";
import { SettingsView, isSettingsDirty } from "./pages/SettingsView";
import { hasUnsavedScan, useSessionStore } from "./store/sessionStore";
import { useSettings } from "./store/settingsStore";
import { serializeSession } from "./lib/sessionSchema";
import type { Session } from "./types";

export type ToastTone = "good" | "warn" | "bad";
export interface SaveStatus { state: "idle" | "saving" | "saved" | "error"; at?: number; error?: string }

export function App() {
  const darkMode = useSessionStore((s) => s.darkMode);
  const toggleDark = useSessionStore((s) => s.toggleDark);
  const operator = useSessionStore((s) => s.session.operator);
  const initials = operator.split(/\s+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  const [tab, setTab] = useState<TabName>("Scan");
  const [toast, setToastState] = useState<{ msg: string; tone: ToastTone; id: number } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [save, setSave] = useState<SaveStatus>({ state: "idle" });
  const saveTimer = useRef<number | null>(null);
  // The session the pending (debounced) write belongs to.
  const dirtySession = useRef<Session | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  // Leaving Settings with unsaved edits asks first.
  const changeTab = (next: TabName) => {
    if (tab === "Settings" && next !== "Settings" && isSettingsDirty()
      && !window.confirm("Leave Settings without saving your changes?")) return;
    setTab(next);
  };

  const showToast = (msg: string | null, tone: ToastTone = "good") =>
    setToastState(msg ? { msg, tone, id: Date.now() } : null);

  // Hydrate from <userData>/sessions (most recent file). A fresh install
  // gets a new, empty session instead of the old synthetic demo data.
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
        console.warn("[session] hydrate failed:", err);
        showToast(`Could not open the last session: ${String(err)}`, "bad");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist after every session change (debounced, atomic write in main).
  // Guarded by `hydrated` so nothing is written before the file is loaded.
  useEffect(() => {
    if (!hydrated || !window.pupa?.session?.save) return;
    // Writes the session captured when it was edited — not whatever session
    // is open by the time the timer fires (an edit made just before
    // switching sessions used to be dropped).
    const flush = async () => {
      if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
      const session = dirtySession.current;
      dirtySession.current = null;
      if (!session?.sessionId) return;
      try {
        const res = await window.pupa!.session.save(serializeSession(session));
        setSave({ state: "saved", at: res?.savedAt ?? Date.now() });
      } catch (err) {
        console.warn("[session] save failed:", err);
        setSave({ state: "error", error: String(err) });
        showToast(`Saving failed: ${String(err)}`, "bad");
      }
    };
    flushRef.current = flush;
    const unsub = useSessionStore.subscribe((state, prev) => {
      if (state.session === prev.session) return;
      if (state.session.sessionId !== prev.session.sessionId) {
        // Switched session: write out the previous one if it had unsaved edits.
        if (dirtySession.current) void flush();
        return;
      }
      dirtySession.current = state.session;
      setSave({ state: "saving" });
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flush, 250);
    });
    const onUnload = () => { if (dirtySession.current) void flush(); };
    window.addEventListener("beforeunload", onUnload);
    return () => { unsub(); window.removeEventListener("beforeunload", onUnload); };
  }, [hydrated]);

  // Closing the window / quitting with a counted scan that was never saved
  // asks first (main process shows the dialog), then writes the session out.
  useEffect(() => {
    const appApi = window.pupa?.app;
    if (!appApi?.onCloseRequested) return;
    return appApi.onCloseRequested(async () => {
      appApi.closeAck();
      const st = useSessionStore.getState();
      if (hydrated && hasUnsavedScan(st)) {
        const choice = await appApi.askUnsavedScan();
        if (choice === "cancel") { appApi.cancelClose(); return; }
        if (choice === "save") st.commitPendingScan();
      }
      await flushRef.current();
      appApi.closeNow();
    });
  }, [hydrated]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToastState(null), toast.tone === "bad" ? 6000 : 2800);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="app-root" data-theme={darkMode ? "dark" : "light"}>
      <TitleBar activeTab={tab} />
      <div className="app">
        <TopNav
          activeTab={tab}
          onTabChange={changeTab}
          darkMode={darkMode}
          onToggleDark={toggleDark}
          operatorInitials={initials || "—"}
          onToast={showToast}
          save={save}
        />
        {!hydrated ? <div style={{ flex: 1 }} />
          : tab === "Scan" ? <ScanView onNavigate={changeTab} onToast={showToast} />
          : tab === "Database" ? <DatabaseView onToast={showToast} onNavigate={changeTab} />
          : <SettingsView onToast={showToast} />}
      </div>
      {toast && (
        <div key={toast.id} className={`toast ${toast.tone}`} role="status">
          <span className="dot" />
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
