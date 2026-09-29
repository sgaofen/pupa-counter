import React, { useEffect } from "react";
import { useUi } from "../store/uiStore";

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

const ROWS: [string[], string][] = [
  [["Space"], "Scan the next sheet"],
  [[MOD, "O"], "Import an image file"],
  [[MOD, "Shift", "N"], "Start a new replicate"],
  [["Click"], "Add a pupa"],
  [["Right-click"], "Delete the pupa under the cursor"],
  [["D"], "Delete the pupa under the cursor"],
  [["Drag dot"], "Move a pupa"],
  [["Drag"], "Pan the scan (or middle mouse button)"],
  [["Wheel"], "Zoom at the cursor"],
  [["+", "−"], "Zoom in / out"],
  [["F"], "Fit the whole scan"],
  [["1"], "Zoom to 100 %"],
  [["T", "B"], "Jump to the top / bottom of the scan"],
  [["←", "↑", "↓", "→"], "Pan"],
  [[MOD, "Z"], "Undo"],
  [[MOD, "Shift", "Z"], "Redo"],
  [["S"], "Show / hide the sheet outline"],
  [["M"], "Show / hide possible misses"],
  [["L"], "Show / hide rank lines"],
  [["?"], "This list"],
];

export function ShortcutList() {
  return (
    <div className="shortcut-grid">
      {ROWS.map(([keys, what]) => (
        <React.Fragment key={what + keys.join()}>
          <span>{keys.map((k) => <span key={k} className="kbd" style={{ marginRight: 3 }}>{k}</span>)}</span>
          <span>{what}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function ShortcutsModal() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="modal-veil" onClick={() => setOpen(false)}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <ShortcutList />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
