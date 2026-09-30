import React, { useEffect, useRef, useState } from "react";
import type { SessionSummary } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { useSettings } from "../store/settingsStore";
import { Icons } from "./icons";
import type { ToastTone } from "../App";

/**
 * Session switcher used in the top nav. Lists every session file in
 * <userData>/sessions/ and lets the operator switch to any of them or
 * spin up a fresh one (auto-named YYYY-MM-DD-HH-MM-SS).
 */
export function SessionPicker({ onToast }: { onToast?: (msg: string, tone?: ToastTone) => void }) {
  const session = useSessionStore((s) => s.session);
  const loadSession = useSessionStore((s) => s.loadSession);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SessionSummary[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || !window.pupa?.session?.list) return;
    window.pupa.session.list().then(setList).catch(() => setList([]));
  }, [open]);

  async function switchTo(id: string) {
    setOpen(false);
    if (!window.pupa?.session?.load || id === session.sessionId) return;
    const data = await window.pupa.session.load(id);
    if (data && loadSession(data)) onToast?.(`Switched to ${id}`);
    else onToast?.(`Could not read session ${id}`, "bad");
  }

  async function createNew() {
    setOpen(false);
    if (!window.pupa?.session?.create) return;
    const data = await window.pupa.session.create({
      operator: session.operator || useSettings.getState().defaultOperator,
      experiment: session.experiment,
    });
    if (data && loadSession(data)) onToast?.(`New session: ${(data as { sessionId: string }).sessionId}`);
  }

  return (
    <div className="session-picker" ref={ref} style={{ position: "relative" }}>
      <button
        className="iconbtn session-picker-btn"
        title={`Session ${session.sessionId} — click to switch or start a new one`}
        onClick={() => setOpen((o) => !o)}
      >
        {Icons.folder}
        <span className="id">{session.sessionId || "no session"}</span>
        <span className="chev">▾</span>
      </button>
      {open && (
        <div className="session-menu">
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 6 }} onClick={createNew}>
            {Icons.plus} New session (dated)
          </button>
          <div className="session-menu-note">
            {list.length} saved session{list.length === 1 ? "" : "s"} · newest first
          </div>
          {list.length === 0 && (
            <div className="session-menu-note" style={{ textAlign: "center", padding: 8 }}>
              No sessions yet — start one above.
            </div>
          )}
          {list.map((s) => {
            const active = s.sessionId === session.sessionId;
            return (
              <div key={s.sessionId} className={`session-menu-item${active ? " active" : ""}`} onClick={() => switchTo(s.sessionId)}>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{s.sessionId}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {s.startedAt || "—"} · {s.replicates} replicate{s.replicates === 1 ? "" : "s"} · {s.scans} scan{s.scans === 1 ? "" : "s"}
                </div>
                {(s.operator || s.experiment) && (
                  <div style={{ fontSize: 11, color: "var(--muted-2)" }}>
                    {[s.operator, s.experiment].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
