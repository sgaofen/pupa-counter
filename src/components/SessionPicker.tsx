import React, { useEffect, useRef, useState } from "react";
import type { SessionSummary } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { useSettings } from "../store/settingsStore";
import { useUi } from "../store/uiStore";
import { Icons } from "./icons";

/** Session switcher: every file in <userData>/sessions, newest first, plus
 *  "New session" (auto-named by date). */
export function SessionPicker() {
  const session = useSessionStore((s) => s.session);
  const loadSession = useSessionStore((s) => s.loadSession);
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SessionSummary[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.pupa?.session.list().then(setList).catch(() => setList([]));
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function switchTo(id: string) {
    setOpen(false);
    if (id === session.sessionId || !window.pupa) return;
    const data = await window.pupa.session.load(id);
    if (data && loadSession(data)) toast(`Opened ${id}`);
    else toast(`Could not read session ${id}`, "bad");
  }

  async function createNew() {
    setOpen(false);
    if (!window.pupa) return;
    const data = await window.pupa.session.create({
      operator: session.operator || useSettings.getState().defaultOperator,
      experiment: session.experiment,
    });
    if (data && loadSession(data)) toast("New session started — replicate 1");
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn btn-ghost session-btn" onClick={() => setOpen((o) => !o)} title="Switch or start a session">
        {Icons.folder}<span className="id">{session.sessionId || "No session"}</span>{Icons.chevDown}
      </button>
      {open && (
        <div className="popover" role="listbox">
          <button className="btn btn-primary" style={{ width: "100%", marginBottom: 6 }} onClick={createNew}>
            {Icons.plus} New session
          </button>
          {list.length === 0 && <div className="opt"><span className="m">No saved sessions yet.</span></div>}
          {list.map((x) => (
            <div key={x.sessionId} className={`opt${x.sessionId === session.sessionId ? " on" : ""}`} onClick={() => switchTo(x.sessionId)} role="option" aria-selected={x.sessionId === session.sessionId}>
              <span className="id">{x.sessionId}</span>
              <span className="m">{x.experiment || "—"} · {x.replicates} replicate{x.replicates === 1 ? "" : "s"} · {x.scans} scan{x.scans === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
