// Screenshot tour for development / verification (never used in normal runs).
//
//   PUPA_TOUR=<out dir> PUPA_TOUR_PREFIX=after PUPA_USE_DIST=1 \
//   PUPA_USER_DATA=<scratch dir> PUPA_DEMO_DIR=<dir with one scan> electron .
//
// Drives the UI only through the DOM (tab buttons, "Load demo scan", the
// theme toggle) so the same tour runs against old and new builds and the
// before / after screenshots line up. If the build exposes
// window.__pupaDebug (v0.5+), a few extra states are captured too.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTour(win, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const prefix = process.env.PUPA_TOUR_PREFIX || "shot";
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const log = [];
  const shot = async (name) => {
    await sleep(800);
    const img = await win.webContents.capturePage();
    const file = path.join(outDir, `${prefix}-${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log(`[tour] ${path.basename(file)}`);
  };
  const clickText = (sel, text) => js(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}));
    if (el) el.click();
    return !!el;
  })()`);
  const waitText = async (texts, timeoutMs = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const hit = await js(`(() => { const t = document.body.innerText; return ${JSON.stringify(texts)}.find((x) => t.includes(x)) || null; })()`);
      if (hit) return hit;
      await sleep(400);
    }
    return null;
  };
  const tab = async (name) => { await clickText(".tab", name); await sleep(400); };
  const hasDebug = async () => js("!!window.__pupaDebug");

  await waitText(["Scan", "Database"], 30000);
  await sleep(2500); // let the session load and the model warm up

  // ---- light
  await tab("Scan");
  await shot("1-scan-empty-light");
  await clickText("button", "Load demo scan");
  log.push({ detect: await waitText(["Detection complete", "Detection failed"]) });
  await shot("2-scan-detected-light");
  await tab("Database");
  await js("(() => { const r = document.querySelectorAll('table.data tbody tr'); if (r.length) r[r.length - 1].click(); })()");
  await shot("3-database-light");
  await tab("Settings");
  await sleep(6500); // scanner probe
  await shot("4-settings-light");

  // ---- extra states (v0.5+ only)
  if (await hasDebug()) {
    await tab("Scan");
    const extra = (process.env.PUPA_TOUR_EXTRA || "").split(path.delimiter).filter(Boolean);
    for (const spec of extra) {
      // spec = name=path[,requested,actual]
      const [name, rest] = spec.split("=");
      const [p, req, act, ana] = rest.split(",");
      await js(`window.__pupaDebug.load(${JSON.stringify(p)}, ${req ? JSON.stringify({ requestedDpi: +req, actualDpi: +act, analysisPath: ana || undefined }) : "null"})`);
      log.push({ [name]: await waitText(["Detection complete", "Detection failed"]) });
      await shot(`x-${name}-light`);
    }
    if (await js("!!window.__pupaDebug.nudgeSheet")) {
      const r = await js("window.__pupaDebug.nudgeSheet()");
      log.push({ sheetEdit: r });
      await shot("x-sheet-adjusted-light");
    }
    if (await js("!!window.__pupaDebug.save")) {
      await js("window.__pupaDebug.save()");
      await sleep(500);
    }
    await tab("Database");
    for (const label of ["Scans CSV", "Per-pupa CSV", "Excel"]) {
      await clickText("button", label);
      await sleep(2500);
    }
    await shot("x-database-exported-light");
    if (process.env.PUPA_TOUR_DELETE) {
      const before = await js("document.querySelectorAll('table.data tbody tr').length");
      await js("(() => { window.confirm = () => true; const r = document.querySelectorAll('table.data tbody tr'); if (r.length) r[r.length - 1].click(); })()");
      await sleep(500);
      const clicked = await clickText("button", "delete scan");
      await sleep(1500);
      const after = await js("document.querySelectorAll('table.data tbody tr').length");
      log.push({ deleteScan: { clicked, rowsBefore: before, rowsAfter: after } });
      await shot("x-database-after-delete-light");
    }
  }

  // ---- dark
  await js("(() => { const b = document.querySelector('.iconbtn[title=\"Toggle theme\"]'); b && b.click(); })()");
  await tab("Scan");
  if (!(await js("document.body.innerText.includes('Detection complete')"))) {
    await clickText("button", "Load demo scan");
    await waitText(["Detection complete", "Detection failed"]);
  }
  await shot("5-scan-detected-dark");
  await tab("Database");
  await js("(() => { const r = document.querySelectorAll('table.data tbody tr'); if (r.length) r[r.length - 1].click(); })()");
  await shot("6-database-dark");
  await tab("Settings");
  await sleep(6500);
  await shot("7-settings-dark");

  fs.writeFileSync(path.join(outDir, `${prefix}-tour-log.json`), JSON.stringify(log, null, 2));
  console.log("[tour] done");
  app.quit();
}

module.exports = { runTour };
