import React, { useMemo, useState } from "react";
import { Icons } from "../components/icons";
import { useSessionStore } from "../store/sessionStore";
import type { ScanRecord } from "../types";

function bandClassFor(idx: number) {
  if (idx === 0) return "band top";
  if (idx === 3) return "band low";
  return "band mid";
}

export function DatabaseView() {
  const session = useSessionStore((s) => s.session);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState<string>(
    session.rounds[session.rounds.length - 1]?.roundId ?? ""
  );

  const rows: ScanRecord[] = useMemo(() => {
    return session.rounds.flatMap((r) => r.scans).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [session]);

  const selectedRound = session.rounds.find((r) => r.roundId === selectedRoundId);
  const scansInRound = selectedRound?.scans ?? [];
  const totalPupaeInRound = scansInRound.reduce((a, s) => a + s.totalPupae, 0);
  const sumShown = rows.reduce((a, s) => a + s.totalPupae, 0);

  const selectedScan = selectedScanId
    ? rows.find((r) => r.id === selectedScanId) ?? null
    : null;

  return (
    <div className="s3-body">
      <aside className="tree">
        <h4>Sessions</h4>
        <div className="tree-item">
          <span className="chev">▾</span>
          <span className="ico">{Icons.folder}</span>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>
            {session.startedAt.slice(0, 10)} — {session.operator}
          </span>
        </div>
        {session.rounds.map((r) => (
          <React.Fragment key={r.roundId}>
            <div
              className={`tree-item child ${selectedRoundId === r.roundId ? "active" : ""}`}
              onClick={() => setSelectedRoundId(r.roundId)}
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
              >
                <span className="chev">·</span>Image {s.imageNumber}
              </div>
            ))}
          </React.Fragment>
        ))}
        <div className="tree-item" style={{ marginTop: 10 }}>
          <span className="chev">▸</span>
          <span className="ico">{Icons.folder}</span>2026-04-15 — Sarah Ruckman
        </div>
        <div className="tree-item">
          <span className="chev">▸</span>
          <span className="ico">{Icons.folder}</span>2026-04-08 — Anthony Long
        </div>
      </aside>

      <section className="db-main">
        <div className="db-header">
          <div>
            <h2>
              Round {selectedRound?.roundNumber ?? 1}
              <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 14 }}>
                {" "}· {session.experiment}
              </span>
            </h2>
            <div className="meta">
              {scansInRound.length} scans · {totalPupaeInRound} pupae · {session.operator} · {selectedRound?.startedAt.slice(0, 10)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary">{Icons.excel} Export to Excel</button>
            <button className="btn">{Icons.download} Export to CSV</button>
          </div>
        </div>

        <div className="filter-bar">
          <span className="chip active">Last 7 days {Icons.x}</span>
          <span className="chip">Operator: Any</span>
          <span className="chip">Genotype: Any</span>
          <span className="chip">Experiment: {session.experiment} {Icons.x}</span>
          <div className="search">{Icons.search}<input className="input" placeholder="Search scan id, comment, file…" /></div>
        </div>

        {/* Split: scan table on the left, per-pupa detail on the right when a scan is selected */}
        <div className="db-split">
          <div className="card table-card">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 88 }}>Scan id</th>
                    <th style={{ width: 56 }}>Round</th>
                    <th style={{ width: 52 }}>Img #</th>
                    <th className="sort">Timestamp</th>
                    <th style={{ textAlign: "right", width: 70 }}>Total</th>
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

          {/* Per-pupa detail panel */}
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
                        <td><span className={`mini-pill ${p.band === "0-5%" ? "manual" : "cnn"}`}
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
