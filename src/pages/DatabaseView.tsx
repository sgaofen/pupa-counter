import React, { useMemo, useState } from "react";
import { Icons } from "../components/icons";
import { useSessionStore } from "../store/sessionStore";
import { useSettings } from "../store/settingsStore";
import { useUi } from "../store/uiStore";
import { recordTop5, top5Indices } from "../lib/bands";
import {
  exportBaseName, pupaRows, PUPA_HEADER, runningRows, scanRows, SCAN_HEADER, toCsv, xlsxSheets,
} from "../lib/exporters";
import type { ScanRecord } from "../types";

type SortKey = "order" | "total" | "top5";

export function DatabaseView() {
  const session = useSessionStore((s) => s.session);
  const openRecord = useSessionStore((s) => s.openRecord);
  const selectReplicate = useSessionStore((s) => s.selectReplicate);
  const exportDir = useSettings((s) => s.exportDir);
  const toast = useUi((s) => s.toast);
  const setTab = useUi((s) => s.setTab);

  const [repFilter, setRepFilter] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "order", dir: 1 });
  const [busy, setBusy] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const running = useMemo(() => runningRows(session), [session]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let r = running.filter((x) => repFilter == null || x.scan.replicateNumber === repFilter);
    if (needle) {
      r = r.filter(({ scan: s }) =>
        [s.id, s.genotype, s.comments, s.operator, s.imagePath, s.infoFilename].some((f) => (f ?? "").toLowerCase().includes(needle)));
    }
    if (sort.key !== "order") {
      r = [...r].sort((a, b) => sort.dir * (sort.key === "total"
        ? a.scan.totalPupae - b.scan.totalPupae
        : recordTop5(a.scan) - recordTop5(b.scan)));
    } else if (sort.dir === -1) r = [...r].reverse();
    return r;
  }, [running, repFilter, search, sort]);

  const scope = repFilter == null ? session.replicates.flatMap((r) => r.scans)
    : session.replicates.find((r) => r.replicateNumber === repFilter)?.scans ?? [];
  const total = scope.reduce((a, s) => a + s.totalPupae, 0);
  const top5 = scope.reduce((a, s) => a + recordTop5(s), 0);
  const selected: ScanRecord | null = running.find((r) => r.scan.id === selectedId)?.scan ?? null;

  const doExport = async (kind: "scans" | "pupae" | "xlsx") => {
    if (!window.pupa) { toast("Exporting needs the desktop app", "warn"); return; }
    if (scope.length === 0) { toast("Nothing to export in this view", "warn"); return; }
    setBusy(kind);
    try {
      const base = exportBaseName(session, repFilter ?? undefined);
      let file: string;
      if (kind === "scans") {
        file = await window.pupa.exporter.text({ dir: exportDir || undefined, filename: `${base}_scans.csv`, content: toCsv(SCAN_HEADER, scanRows(session, repFilter ?? undefined)) });
      } else if (kind === "pupae") {
        file = await window.pupa.exporter.text({ dir: exportDir || undefined, filename: `${base}_pupae.csv`, content: toCsv(PUPA_HEADER, pupaRows(session, repFilter ?? undefined)) });
      } else {
        file = await window.pupa.exporter.xlsx({ dir: exportDir || undefined, filename: `${base}.xlsx`, sheets: xlsxSheets(session, repFilter ?? undefined) });
      }
      setLastExport(file);
      await window.pupa.shell.showItemInFolder(file);
      toast(`Exported ${file.split(/[\\/]/).pop()}`, "good", { label: "Show in folder", run: () => window.pupa?.shell.showItemInFolder(file) });
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': /, "") : String(err)}`, "bad");
    } finally {
      setBusy(null);
    }
  };

  const openInEditor = async (rec: ScanRecord) => {
    let url: string | null = null;
    try {
      if (window.pupa && (await window.pupa.file.exists(rec.imagePath))) url = await window.pupa.file.readImageDataUrl(rec.imagePath);
    } catch { url = null; }
    const rep = session.replicates.find((r) => r.replicateNumber === rec.replicateNumber);
    if (rep) selectReplicate(rep.replicateId);
    openRecord(rec, url);
    setTab("Scan");
    if (!url) toast(`Image file not found on this computer: ${rec.imagePath}`, "warn");
  };

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "order" ? 1 : -1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  let lastRep = -1;
  const top = selected ? top5Indices(selected.pupae) : new Set<number>();

  return (
    <div className="data-page">
      <nav className="data-side" aria-label="Replicates">
        <div className="label grp">This session</div>
        <div className={`item${repFilter == null ? " on" : ""}`} onClick={() => setRepFilter(null)}>
          <span>All replicates</span><span className="c">{session.replicates.reduce((a, r) => a + r.scans.length, 0)}</span>
        </div>
        {session.replicates.map((r) => (
          <div key={r.replicateId} className={`item${repFilter === r.replicateNumber ? " on" : ""}`} onClick={() => setRepFilter(r.replicateNumber)}>
            <span>Replicate {r.replicateNumber}</span><span className="c">{r.scans.length}</span>
          </div>
        ))}
      </nav>

      <section className="data-main">
        <header className="data-head">
          <div>
            <h1>{repFilter == null ? "All replicates" : `Replicate ${repFilter}`}</h1>
            <div className="sub mono">{session.sessionId} · {session.experiment || "no experiment name"} · {session.operator || "no operator"}</div>
          </div>
          <div className="kpis">
            <div className="kpi"><div className="k">Scans</div><div className="v">{scope.length}</div></div>
            <div className="kpi"><div className="k">Pupae</div><div className="v">{total.toLocaleString()}</div></div>
            <div className="kpi"><div className="k">Top 5%</div><div className="v top5">{top5.toLocaleString()}</div></div>
          </div>
        </header>

        <div className="export-bar">
          <button className="btn btn-primary" onClick={() => doExport("scans")} disabled={!!busy} title="One row per scan, with running totals and sheet info">
            {Icons.download} {busy === "scans" ? "Exporting…" : "Scans CSV"}
          </button>
          <button className="btn" onClick={() => doExport("pupae")} disabled={!!busy} title="One row per pupa: position, rank, band, sheet position, source">
            {Icons.download} {busy === "pupae" ? "Exporting…" : "Per-pupa CSV"}
          </button>
          <button className="btn" onClick={() => doExport("xlsx")} disabled={!!busy} title="Both tables in one Excel workbook">
            {Icons.table} {busy === "xlsx" ? "Exporting…" : "Excel workbook"}
          </button>
          <span className="where" title={lastExport ?? exportDir}>
            {lastExport ? `Last: ${lastExport}` : `Saves to ${exportDir || "Documents/Pupa Counter Exports"}`}
          </span>
          {lastExport && <button className="btn btn-ghost btn-sm" onClick={() => window.pupa?.shell.showItemInFolder(lastExport)}>{Icons.folder} Show</button>}
          <span className="grow" />
          <input className="input" style={{ width: 240 }} placeholder="Filter by genotype, comment, file…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter scans" />
        </div>

        <div className="data-split">
          <div className="table-wrap">
            {rows.length === 0 ? (
              <div className="empty-state">{search ? "No scans match this filter." : "No scans in this view yet."}</div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th className="sort" onClick={() => sortBy("order")}>Scan{arrow("order")}</th>
                    <th>Time</th>
                    <th>Genotype</th>
                    <th>Comments</th>
                    <th className="r sort" onClick={() => sortBy("total")}>Pupae{arrow("total")}</th>
                    <th className="r sort" onClick={() => sortBy("top5")}>Top 5%{arrow("top5")}</th>
                    <th className="r" title="Running total within the replicate">Σ pupae</th>
                    <th className="r" title="Running top-5 % total within the replicate">Σ top 5%</th>
                    <th className="r">DPI</th>
                    <th>Sheet</th>
                    <th>Edited</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ scan: s, repTotal, repTop5 }) => {
                    const sep = sort.key === "order" && repFilter == null && s.replicateNumber !== lastRep;
                    lastRep = s.replicateNumber;
                    return (
                      <React.Fragment key={s.id}>
                        {sep && <tr className="rep-sep"><td colSpan={11}>Replicate {s.replicateNumber}</td></tr>}
                        <tr className={selectedId === s.id ? "on" : ""} onClick={() => setSelectedId(s.id)} onDoubleClick={() => openInEditor(s)}>
                          <td className="num">R{s.replicateNumber}·{s.imageNumber}</td>
                          <td className="num muted">{s.timestamp.slice(5, 16)}</td>
                          <td>{s.genotype}</td>
                          <td className="muted" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{s.comments}</td>
                          <td className="r" style={{ fontWeight: 600 }}>{s.totalPupae}</td>
                          <td className="r top5">{recordTop5(s)}</td>
                          <td className="r run">{repTotal}</td>
                          <td className="r run">{repTop5}</td>
                          <td className="r">{s.actualDpi ?? <span className="muted">—</span>}</td>
                          <td>{s.sheet?.found ? (s.sheet.manual ? <span className="pill accent">adjusted</span> : <span className="pill">auto</span>) : <span className="muted">—</span>}</td>
                          <td>{s.manuallyEdited ? <span className="pill good">yes</span> : <span className="muted">no</span>}</td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <aside className="detail">
            {selected ? (
              <>
                <div className="detail-head">
                  <h2>Replicate {selected.replicateNumber} · scan {selected.imageNumber}</h2>
                  <div className="sub">{selected.totalPupae} pupae · top 5 % = {recordTop5(selected)} · {selected.genotype || "no genotype"}</div>
                  <div className="sub mono" style={{ wordBreak: "break-all" }}>{selected.imagePath}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => openInEditor(selected)}>{Icons.external} Open in Scan view</button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr><th className="r">#</th><th className="r">x</th><th className="r">y</th><th className="r">rank %</th><th>band</th><th className="r" title="0 = sheet bottom, 100 = sheet top">sheet %</th><th>source</th></tr>
                    </thead>
                    <tbody>
                      {selected.pupae.map((p, i) => (
                        <tr key={i} style={{ cursor: "default" }}>
                          <td className="r muted">{p.index}{top.has(i) && <span className="flag-top5" title="In the top 5 %"> •</span>}</td>
                          <td className="r">{p.x}</td>
                          <td className="r">{p.y}</td>
                          <td className="r">{p.rankPct.toFixed(1)}</td>
                          <td className="num">{p.band}</td>
                          <td className="r">{typeof p.sheetPct === "number" ? p.sheetPct.toFixed(1) : "—"}</td>
                          <td><span className={`src ${p.source}`}>{p.source}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="empty">Select a scan to see every pupa. Double-click a row to open it for editing.</div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
