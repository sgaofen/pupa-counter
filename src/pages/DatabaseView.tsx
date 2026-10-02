import React, { useMemo, useState } from "react";
import { Icons } from "../components/icons";
import { useSessionStore } from "../store/sessionStore";
import { useSettings } from "../store/settingsStore";
import { recordTop5, top5Indices } from "../lib/bands";
import {
  exportBaseName, pupaRows, PUPA_HEADER, runningRows, scanRows, SCAN_HEADER, toCsv, xlsxSheets,
} from "../lib/exporters";
import type { ScanRecord } from "../types";
import type { TabName } from "../components/TopNav";
import type { ToastTone } from "../App";

function bandClassFor(idx: number) {
  if (idx === 0) return "band top";
  if (idx === 3) return "band low";
  return "band mid";
}

type SortKey = "timestamp" | "total";
type SortDir = "asc" | "desc";

interface Props {
  onToast: (msg: string, tone?: ToastTone) => void;
  onNavigate: (tab: TabName) => void;
}

export function DatabaseView({ onToast }: Props) {
  const session = useSessionStore((s) => s.session);
  const exportDir = useSettings((s) => s.exportDir);

  // Empty string = "all replicates" in this session.
  const [selectedRepId, setSelectedRepId] = useState<string>("");
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [exporting, setExporting] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const running = useMemo(() => runningRows(session), [session]);
  const selectedRep = session.replicates.find((r) => r.replicateId === selectedRepId);

  const rows = useMemo(() => {
    const scope = running.filter((r) => !selectedRep || r.scan.replicateNumber === selectedRep.replicateNumber);
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? scope.filter(({ scan: s }) =>
          [s.id, s.comments, s.imagePath, s.genotype, s.operator, s.infoFilename]
            .some((f) => (f ?? "").toLowerCase().includes(needle)))
      : scope;
    return [...filtered].sort((a, b) => {
      const cmp = sortKey === "total"
        ? a.scan.totalPupae - b.scan.totalPupae
        : a.scan.timestamp.localeCompare(b.scan.timestamp);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [running, selectedRep, search, sortKey, sortDir]);

  const scansInRep = selectedRep?.scans ?? [];
  const totalPupaeInRep = scansInRep.reduce((a, s) => a + s.totalPupae, 0);
  const top5InRep = scansInRep.reduce((a, s) => a + recordTop5(s), 0);
  const sumShown = rows.reduce((a, r) => a + r.scan.totalPupae, 0);
  const top5Shown = rows.reduce((a, r) => a + recordTop5(r.scan), 0);

  const selectedScan: ScanRecord | null = selectedScanId
    ? running.find((r) => r.scan.id === selectedScanId)?.scan ?? null
    : null;
  const top5Sel = selectedScan ? top5Indices(selectedScan.pupae) : new Set<number>();

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const doExport = async (kind: "scans" | "pupae" | "xlsx") => {
    if (!window.pupa) { onToast("Exporting needs the desktop app", "warn"); return; }
    const repNo = selectedRep?.replicateNumber;
    if (!running.some((r) => repNo == null || r.scan.replicateNumber === repNo)) {
      onToast("Nothing to export in this view", "warn");
      return;
    }
    setExporting(kind);
    try {
      const base = exportBaseName(session, repNo);
      const dir = exportDir || undefined;
      const file = kind === "scans"
        ? await window.pupa.exporter.text({ dir, filename: `${base}_scans.csv`, content: toCsv(SCAN_HEADER, scanRows(session, repNo)) })
        : kind === "pupae"
        ? await window.pupa.exporter.text({ dir, filename: `${base}_pupae.csv`, content: toCsv(PUPA_HEADER, pupaRows(session, repNo)) })
        : await window.pupa.exporter.xlsx({ dir, filename: `${base}.xlsx`, sheets: xlsxSheets(session, repNo) });
      setLastExport(file);
      await window.pupa.shell.showItemInFolder(file);
      onToast(`Exported ${file.split(/[\\/]/).pop()}`);
    } catch (err) {
      onToast(`Export failed — ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err)}`, "bad");
    } finally {
      setExporting(null);
    }
  };

  const headerTitle = selectedRep ? `Replicate ${selectedRep.replicateNumber}` : "All replicates in this session";
  const scopeLabel = selectedRep ? `replicate ${selectedRep.replicateNumber}` : "the whole session";

  return (
    <div className="s3-body">
      <aside className="tree">
        <h4>Session</h4>
        <div
          className={`tree-item ${!selectedRepId ? "active" : ""}`}
          onClick={() => { setSelectedRepId(""); setSelectedScanId(null); }}
        >
          <span className="chev">{!selectedRepId ? "▾" : "▸"}</span>
          <span className="ico">{Icons.folder}</span>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>
            {session.startedAt.slice(0, 10)} — {session.operator || "no operator"}
          </span>
        </div>
        {session.replicates.map((r) => (
          <React.Fragment key={r.replicateId}>
            <div
              className={`tree-item child ${selectedRepId === r.replicateId ? "active" : ""}`}
              onClick={() => { setSelectedRepId(r.replicateId); setSelectedScanId(null); }}
            >
              <span className="chev">{selectedRepId === r.replicateId ? "▾" : "▸"}</span>
              Replicate {r.replicateNumber}
              <span className="count">{r.scans.length} scan{r.scans.length === 1 ? "" : "s"}</span>
            </div>
            {selectedRepId === r.replicateId && r.scans.map((s) => (
              <div
                key={s.id}
                className={`tree-item child2 ${selectedScanId === s.id ? "active" : ""}`}
                onClick={() => setSelectedScanId(s.id)}
              >
                <span className="chev">·</span>Image {s.imageNumber}
                <span className="count">{s.totalPupae}</span>
              </div>
            ))}
          </React.Fragment>
        ))}
      </aside>

      <section className="db-main">
        <div className="db-header">
          <div>
            <h2>
              {headerTitle}
              <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 14 }}>
                {" "}· {session.experiment || "no experiment name"}
              </span>
            </h2>
            <div className="meta">
              {selectedRep
                ? [`${scansInRep.length} scan${scansInRep.length === 1 ? "" : "s"}`, `${totalPupaeInRep.toLocaleString()} pupae`,
                    `top 5 %: ${top5InRep.toLocaleString()}`, session.operator, selectedRep.startedAt.slice(0, 10)].filter(Boolean).join(" · ")
                : `${running.length} scan${running.length === 1 ? "" : "s"} across ${session.replicates.length} replicate${session.replicates.length === 1 ? "" : "s"} · ${session.operator || "no operator"}`}
            </div>
          </div>
          <div className="db-export">
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => doExport("scans")} disabled={!!exporting}
                title={`One row per scan in ${scopeLabel}: counts, top-5 % and running totals, sheet, DPI`}>
                {Icons.download} {exporting === "scans" ? "Exporting…" : "Scans CSV"}
              </button>
              <button className="btn" onClick={() => doExport("pupae")} disabled={!!exporting}
                title={`One row per pupa in ${scopeLabel}: x, y, rank %, band, sheet %, source`}>
                {Icons.download} {exporting === "pupae" ? "Exporting…" : "Per-pupa CSV"}
              </button>
              <button className="btn" onClick={() => doExport("xlsx")} disabled={!!exporting}
                title="Both tables in one Excel workbook">
                {Icons.excel} {exporting === "xlsx" ? "Exporting…" : "Excel"}
              </button>
            </div>
            <div className={`hint mono${lastExport ? " with-link" : ""}`} title={lastExport ?? undefined}>
              {lastExport
                ? <><span style={{ flex: "none" }}>Last export:</span><button className="link-btn mono" title="Show in Finder" onClick={() => window.pupa?.shell.showItemInFolder(lastExport)}>{lastExport.split(/[\\/]/).pop()}</button></>
                : `Exports ${scopeLabel} to ${exportDir || "Documents/Pupa Counter Exports"}`}
            </div>
          </div>
        </div>

        <div className="filter-bar">
          <div className="search" style={{ flex: 1 }}>
            {Icons.search}
            <input
              className="input"
              placeholder="Search scan id, comment, file, genotype, operator…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="db-split">
          <div className="card table-card">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>Scan id</th>
                    <th style={{ width: 44 }}>Rep</th>
                    <th style={{ width: 44 }} className="r">Img #</th>
                    <th className="sort-h" onClick={() => toggleSort("timestamp")} title="Toggle sort">
                      Timestamp {sortKey === "timestamp" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                    </th>
                    <th className="r sort-h" onClick={() => toggleSort("total")} title="Toggle sort">
                      Total {sortKey === "total" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                    </th>
                    <th className="r" title="Top 5 % by count (the pupae that are picked)">Top 5%</th>
                    <th className="r" title="Running total of pupae within the replicate">Σ Total</th>
                    <th className="r" title="Running total of top 5 % within the replicate">Σ Top 5%</th>
                    <th className="r">0–5%</th>
                    <th className="r">5–25%</th>
                    <th className="r">25–75%</th>
                    <th className="r">75–100%</th>
                    <th>Genotype</th>
                    <th>Operator</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ scan: r, repTotal, repTop5 }) => (
                    <tr
                      key={r.id}
                      className={selectedScanId === r.id ? "selected" : ""}
                      onClick={() => setSelectedScanId(r.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="mono" style={{ color: "var(--accent)" }}>{r.id}</td>
                      <td>R{r.replicateNumber}</td>
                      <td className="num">{r.imageNumber}</td>
                      <td className="muted mono" style={{ fontSize: 11.5 }}>{r.timestamp}</td>
                      <td className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>{r.totalPupae.toLocaleString()}</td>
                      <td className="num" style={{ fontWeight: 600, color: "var(--accent)" }}>{recordTop5(r)}</td>
                      <td className="num muted">{repTotal.toLocaleString()}</td>
                      <td className="num muted">{repTop5.toLocaleString()}</td>
                      <td className="num"><span className={bandClassFor(0)}>{r.top5PctCount}</span></td>
                      <td className="num"><span className={bandClassFor(1)}>{r.rank5To25Count}</span></td>
                      <td className="num"><span className={bandClassFor(2)}>{r.middle50Count}</span></td>
                      <td className="num"><span className={bandClassFor(3)}>{r.bottom25Count}</span></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{r.genotype}</td>
                      <td>{r.operator}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={14} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                        {search ? "No scans match the current search." : "No saved scans here yet — scans appear after Save to database."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <div>Showing {rows.length} scan{rows.length === 1 ? "" : "s"}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span>Sum: <b className="mono">{sumShown.toLocaleString()}</b></span>
                <span style={{ color: "var(--muted-2)" }}>·</span>
                <span>Top 5%: <b className="mono">{top5Shown.toLocaleString()}</b></span>
                <span style={{ color: "var(--muted-2)" }}>·</span>
                <span>Mean: <b className="mono">{rows.length ? (sumShown / rows.length).toFixed(1) : "0.0"}</b></span>
              </div>
            </div>
          </div>

          <div className="card detail-card">
            <div className="detail-head">
              <h3>
                {selectedScan ? `${selectedScan.id} · Image ${selectedScan.imageNumber}` : "Per-pupa detail"}
              </h3>
              <div className="sub">
                {selectedScan
                  ? <>
                      {`${selectedScan.pupae.length} pupae · top 5 % = ${recordTop5(selectedScan)} · ${selectedScan.manuallyEdited ? "manually edited" : "CNN only"}${selectedScan.actualDpi ? ` · ${selectedScan.actualDpi} dpi` : ""}${selectedScan.sheet?.found ? ` · sheet ${selectedScan.sheet.manual ? "adjusted" : "auto"}` : ""} · `}
                      <button className="link-btn" title={selectedScan.imagePath}
                        onClick={async () => {
                          if (!window.pupa) return;
                          if (await window.pupa.file.exists(selectedScan.imagePath)) window.pupa.shell.showItemInFolder(selectedScan.imagePath);
                          else onToast(`Image file not found: ${selectedScan.imagePath}`, "warn");
                        }}>show image</button>
                      {" · "}
                      <button className="link-btn" style={{ color: "var(--bad)" }}
                        title="Remove this scan from the session (the image file stays on disk)"
                        onClick={() => {
                          const s = selectedScan;
                          const label = `${s.id} · image ${s.imageNumber} (${s.pupae.length} pupae)`;
                          if (!window.confirm(`Delete scan ${label} from this session?\n\nIts counts are removed from the totals and exports. The image file stays on disk.`)) return;
                          if (useSessionStore.getState().deleteScan(s.id)) {
                            setSelectedScanId(null);
                            onToast(`Deleted scan ${label} — image file kept`, "warn");
                          }
                        }}>delete scan</button>
                    </>
                  : "Select a scan row to inspect every detected pupa"}
              </div>
            </div>
            <div className="detail-body">
              {selectedScan ? (
                <table className="detail-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th style={{ textAlign: "right" }}>x</th>
                      <th style={{ textAlign: "right" }}>y</th>
                      <th style={{ textAlign: "right" }}>rank %</th>
                      <th>band</th>
                      <th style={{ textAlign: "right" }} title="0 = sheet bottom end, 100 = sheet top end">sheet %</th>
                      <th>source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedScan.pupae.map((p, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ color: top5Sel.has(i) ? "var(--bad)" : "var(--muted)", fontWeight: top5Sel.has(i) ? 600 : 400 }}
                          title={top5Sel.has(i) ? "In the top 5 %" : undefined}>{p.index}</td>
                        <td className="num mono">{Math.round(p.x)}</td>
                        <td className="num mono">{Math.round(p.y)}</td>
                        <td className="num mono">{p.rankPct.toFixed(1)}</td>
                        <td><span className="mini-pill"
                          style={{
                            background: p.band === "0-5%" ? "rgba(180,54,46,0.12)" : p.band === "75-100%" ? "rgba(31,122,78,0.14)" : "rgba(199,122,29,0.12)",
                            color: p.band === "0-5%" ? "var(--bad)" : p.band === "75-100%" ? "var(--good)" : "var(--warn)",
                          }}>
                          {p.band}
                        </span></td>
                        <td className="num mono">{typeof p.sheetPct === "number" ? p.sheetPct.toFixed(1) : "—"}</td>
                        <td><span className={`mini-pill ${p.source}`}>{p.source}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                  Click any scan row on the left to see its per-pupa breakdown here.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
