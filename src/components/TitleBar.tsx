import React from "react";

/**
 * Empty draggable strip that sits above the TopNav, matching the
 * macOS "hiddenInset" titlebar. Electron draws the traffic lights on
 * top of this automatically; we just provide the drag region + title.
 */
export function TitleBar({ activeTab }: { activeTab: string }) {
  return (
    <div className="titlebar">
      <div className="title">Pupa Counter — {activeTab}</div>
    </div>
  );
}
