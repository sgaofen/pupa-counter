import React, { useMemo, useState } from "react";
import { Icons } from "../components/icons";
import { useSessionStore } from "../store/sessionStore";
import type { ScanRecord } from "../types";

function bandClassFor(idx: number) {
  if (idx === 0) return "band top";
  if (idx === 3) return "band low";
  return "band mid";
}

function csvField(v: string | number): string {
  const s = String(v ?? "");
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: ScanRecord[]): string {
  const header = [
    "scan_id", "round", "image_num", "timestamp",
    "total", "top_0_5", "rank_5_25", "middle_25_75", "bottom_75_100",
    "operator", "experiment", "genotype", "comments", "file_path",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.id, r.roundNumber, r.imageNumber, r.timestamp,
      r.totalPupae, r.top5PctCount, r.rank5To25Count, r.middle50Count, r.bottom25Count,
      r.operator, r.experiment, r.genotype,
      (r.comments ?? "").replace(/[\r\n]+/g, " "),
      r.imagePath,
    ].map(csvField).join(","));
  }
  return lines.join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

type SortKey = "timestamp" | "total";
type SortDir = "asc" | "desc";

export function DatabaseView() {
  const session = useSessionStore((s) => s.session);

  // Empty string = "all rounds" in this session.
  const [selectedRoundId, setSelectedRoundId] = useState<string>("");
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // All scans in the session, optionally filtered by round + search.
  const rows: ScanRecord[] = useMemo(() => {
    const scope = selectedRoundId
      ? session.rounds.find((r) => r.roundId === selectedRoundId)?.scans ?? []
      : session.rounds.flatMap((r) => r.scans);
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? scope.filter((s) =>
          s.id.toLowerCase().includes(needle) ||
          s.comments.toLowerCase().includes(needle) ||
          s.imagePath.toLowerCase().includes(needle) ||
          s.genotype.toLowerCase().includes(needle) ||
          s.operator.toLowerCase().includes(needle)
        )
      : scope;
    const sorted = [...filtered].sort((a, b) => {
      let cmp: number;
      if (sortKey === "total") cmp = a.totalPupae - b.totalPupae;
      else cmp = a.timestamp.localeCompare(b.timestamp);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [session, selectedRoundId, search, sortKey, sortDir]);

  const selectedRound = session.rounds.find((r) => r.roundId === selectedRoundId);
  const scansInRound = selectedRound?.scans ?? [];
  const totalPupaeInRound = scansInRound.reduce((a, s) => a + s.totalPupae, 0);
  const sumShown = rows.reduce((a, s) => a + s.totalPupae, 0);

  const selectedScan = selectedScanId
    ? rows.find((r) => r.id === selectedScanId) ?? null
    : null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const handleExportCsv = () => {
    if (rows.length === 0) return;
    const tag = selectedRound ? `round${selectedRound.roundNumber}` : "all";
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`pupa_counts_${tag}_${stamp}.csv`, toCsv(rows));
  };

  const headerTitle = selectedRound
    ? `Round ${selectedRound.roundNumber}`
    : `All rounds in this session`;

  return (
    <div className="s3-body">
      <aside className="tree">
        <h4>Session</h4>
        <div
          className={`tree-item ${!selectedRoundId ? "active" : ""}`}
          onClick={() => { setSelectedRoundId(""); setSelectedScanId(null); }}
          style={{ cursor: "pointer" }}
        >
          <span className="chev">{!selectedRoundId ? "▾" : "▸"}</span>
          <span className="ico">{Icons.folder}</span>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>
            {session.startedAt.slice(0, 10)} — {session.operator}
          </span>
        </div>
        {session.rounds.map((r) => (
          <React.Fragment key={r.roundId}>
            <div
              className={`tree-item child ${selectedRoundId === r.roundId ? "active" : ""}`}
              onClick={() => { setSelectedRoundId(r.roundId); setSelectedScanId(null); }}
              style={{ cursor: "pointer" }}
            >
              <span className="chev">{selectedRoundId === r.roundId ? "▾" : "▸"}</span>
              Round {r.roundNumber}
              <span className="count">{r.scans.length} scans</span>
            </div>
            {selectedRoundId === r.roundId && r.scans.map((s) => (
              <div
                key={s.id}
                className={`tree-item child2 ${selectedScanId === s.id ? "active" : ""}`}
                onClick={() => setSelectedScanId(s.id)}
                style={{ cursor: "pointer" }}
              >
                <span className="chev">·</span>Image {s.imageNumber}
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
                {" "}· {session.experiment}
              </span>
            </h2>
            <div className="meta">
              {selectedRound
                ? `${scansInRound.length} scans · ${totalPupaeInRound} pupae · ${session.operator} · ${selectedRound.startedAt.slice(0, 10)}`
                : `${rows.length} scans across ${session.rounds.length} round${session.rounds.length === 1 ? "" : "s"} · ${session.operator}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn"
              onClick={handleExportCsv}
              disabled={rows.length === 0}
              title={rows.length === 0 ? "Nothing to export" : "Download visible rows as CSV"}
            >
              {Icons.download} Export to CSV
            </button>
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
                    <th style={{ width: 88 }}>Scan id</th>
                    <th style={{ width: 56 }}>Round</th>
                    <th style={{ width: 52 }}>Img #</th>
                    <th
                      className="sort"
                      onClick={() => toggleSort("timestamp")}
                      style={{ cursor: "pointer" }}
                      title="Toggle sort"
                    >
                      Timestamp {sortKey === "timestamp" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                    </th>
                    <th
                      className="sort"
                      style={{ textAlign: "right", width: 70, cursor: "pointer" }}
                      onClick={() => toggleSort("total")}
                      title="Toggle sort"
                    >
                      Total {sortKey === "total" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                    </th>
                    <th style={{ textAlign: "right", width: 60 }}>0–5%</th>
                    <th style={{ textAlign: "right", width: 68 }}>5–25%</th>
                    <th style={{ textAlign: "right", width: 68 }}>25–75%</th>
                    <th style={{ textAlign: "right", width: 70 }}>75–100%</th>
                    <th>Operator</th>
                    <th>Genotype</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={selectedScanId === r.id ? "selected" : ""}
                      onClick={() => setSelectedScanId(r.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="mono" style={{ color: "var(--accent)" }}>{r.id}</td>
                      <td>R{r.roundNumber}</td>
                      <td className="num">{r.imageNumber}</td>
                      <td className="muted mono" style={{ fontSize: 11.5 }}>{r.timestamp}</td>
                      <td className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>{r.totalPupae}</td>
                      <td className="num"><span className={bandClassFor(0)}>{r.top5PctCount}</span></td>
                      <td className="num"><span className={bandClassFor(1)}>{r.rank5To25Count}</span></td>
                      <td className="num"><span className={bandClassFor(2)}>{r.middle50Count}</span></td>
                      <td className="num"><span className={bandClassFor(3)}>{r.bottom25Count}</span></td>
                      <td>{r.operator}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{r.genotype}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={11} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                        {search ? "No scans match the current search." : "No scans in this view."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{
              padding: "8px 14px", borderTop: "1px solid var(--hairline)",
              display: "flex", justifyContent: "space-between",
              alignItems: "center", fontSize: 11.5, color: "var(--muted)",
            }}>
              <div>Showing {rows.length} scans</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span>Sum: <b style={{ color: "var(--ink)" }} className="mono">{sumShown}</b></span>
                <span style={{ color: "var(--muted-2)" }}>·</span>
                <span>Mean: <b style={{ color: "var(--ink)" }} className="mono">
                  {rows.length ? (sumShown / rows.length).toFixed(1) : "0.0"}
                </b></span>
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
                  ? `${selectedScan.pupae.length} pupae · ${selectedScan.manuallyEdited ? "manually edited" : "CNN only"}`
                  : "Select a scan row to inspect every detected pupa"}
              </div>
            </div>
            <div className="detail-body">
              {selectedScan ? (
                <table className="detail-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>#</th>
                      <th style={{ textAlign: "right", width: 56 }}>x</th>
                      <th style={{ textAlign: "right", width: 56 }}>y</th>
                      <th style={{ textAlign: "right", width: 64 }}>rank %</th>
                      <th style={{ width: 72 }}>band</th>
                      <th style={{ width: 64 }}>source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedScan.pupae.map((p) => (
                      <tr key={p.index}>
                        <td className="mono" style={{ color: "var(--muted)" }}>{p.index}</td>
                        <td className="num mono">{p.x}</td>
                        <td className="num mono">{p.y}</td>
                        <td className="num mono">{p.rankPct.toFixed(1)}</td>
                        <td><span className="mini-pill"
                          style={{
                            background: p.band === "0-5%" ? "rgba(180,54,46,0.12)" : p.band === "75-100%" ? "rgba(31,122,78,0.14)" : "rgba(199,122,29,0.12)",
                            color: p.band === "0-5%" ? "var(--bad)" : p.band === "75-100%" ? "var(--good)" : "var(--warn)",
                          }}>
                          {p.band}
                        </span></td>
                        <td><span className={`mini-pill ${p.source}`}>{p.source}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{
                  padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12,
                }}>
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
