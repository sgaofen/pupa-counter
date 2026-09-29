// Screenshot tour for development / verification.
//
//   PUPA_TOUR=<out dir> PUPA_USE_DIST=1 PUPA_USER_DATA=<scratch dir> \
//   PUPA_TOUR_IMAGES="a.png:b.png" PUPA_TOUR_SCAN=1 electron .
//
// Drives the real UI through window.__pupaDebug, captures each page in
// light and dark, then quits. Never enabled in normal use.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTour(win, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const log = [];
  const shot = async (name) => {
    await sleep(700);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    log.push({ shot: name });
    console.log(`[tour] ${name}.png`);
  };
  const waitIdle = async (label, timeoutMs = 300000) => {
    const t0 = Date.now();
    await sleep(400);
    while (Date.now() - t0 < timeoutMs) {
      const st = await js("window.__pupaDebug.state()");
      if (st.stage !== "scanning" && st.stage !== "detecting") { log.push({ step: label, state: st }); return st; }
      await sleep(400);
    }
    throw new Error(`timeout waiting for ${label}`);
  };

  // Wait for the app and the Python daemon.
  for (let i = 0; i < 120; i++) {
    const ok = await js("!!(window.__pupaDebug && window.__pupaDebug.state && window.__pupaDebug.importPath)").catch(() => false);
    if (ok) break;
    await sleep(500);
  }
  const info = await js("window.pupa.cnn.info()");
  log.push({ cnnInfo: info });

  const images = (process.env.PUPA_TOUR_IMAGES || "").split(path.delimiter).filter(Boolean);
  for (const theme of ["light", "dark"]) {
    await js(`window.__pupaDebug.setTheme(${JSON.stringify(theme)})`);
    await js("window.__pupaDebug.setTab('Scan')");
    if (theme === "light") {
      await shot(`01-scan-start-${theme}`);
      for (let i = 0; i < images.length; i++) {
        await js(`window.__pupaDebug.importPath(${JSON.stringify(images[i])})`);
        await waitIdle(`import ${path.basename(images[i])}`);
        await shot(`02-scan-counted-${i + 1}-${theme}`);
      }
      // DPI chain: images that are really 300 DPI (inferred from pixel size).
      const hi = (process.env.PUPA_TOUR_HIDPI || "").split(path.delimiter).filter(Boolean);
      for (let i = 0; i < hi.length; i++) {
        await js(`window.__pupaDebug.importPath(${JSON.stringify(hi[i])})`);
        await waitIdle(`hidpi ${path.basename(hi[i])}`);
        await shot(`07-dpi-${i + 1}-${path.basename(hi[i], ".png")}-${theme}`);
      }
      // What the old WIA bug looked like: asked for 300, got 150.
      if (images.length) {
        await js(`window.__pupaDebug.importPath(${JSON.stringify(images[0])}, { requestedDpi: 300, actualDpi: 150 })`);
        await waitIdle("simulated DPI mismatch");
        await shot(`08-dpi-mismatch-warning-${theme}`);
        // Hand-adjust the sheet outline and check sheet % is recomputed.
        const before = await js("window.__pupaDebug.pupae()");
        const st = await js("window.__pupaDebug.state()");
        const c = st.work.sheet.corners;
        const moved = [[c[0][0] + 150, c[0][1] + 120], [c[1][0] - 60, c[1][1] + 120], [c[2][0] - 60, c[2][1] - 60], [c[3][0] + 150, c[3][1] - 60]];
        await js(`window.__pupaDebug.setSheet(${JSON.stringify(moved)})`);
        const after = await js("window.__pupaDebug.pupae()");
        log.push({ sheetEdit: { corners: moved, before: before.slice(0, 5), after: after.slice(0, 5), sheet: (await js("window.__pupaDebug.state()")).work.sheet } });
        await js("window.__pupaDebug.fit && window.__pupaDebug.fit()");
        await shot(`09-sheet-adjusted-${theme}`);
      }
      if (process.env.PUPA_TOUR_SCAN === "1") {
        js("window.__pupaDebug.scan()");
        await sleep(1500);
        await shot(`03-scanning-${theme}`);
        await waitIdle("mac scan");
        await shot(`03-scan-result-${theme}`);
        if (images.length) {
          await js(`window.__pupaDebug.importPath(${JSON.stringify(images[images.length - 1])})`);
          await waitIdle("re-import");
        }
      }
    } else {
      await shot(`02-scan-counted-${theme}`);
    }
    await js("window.__pupaDebug.setTab('Data')");
    await sleep(300);
    await js("(() => { const r = [...document.querySelectorAll('table.data tbody tr')].filter(t => !t.classList.contains('rep-sep')); if (r.length) r[r.length-1].click(); })()");
    await shot(`04-data-${theme}`);
    if (theme === "light") {
      // Export all three formats through the real buttons.
      for (const label of ["Scans CSV", "Per-pupa CSV", "Excel workbook"]) {
        await js(`(() => { const b = [...document.querySelectorAll('.export-bar button')].find(b => b.textContent.includes(${JSON.stringify(label)})); b && b.click(); })()`);
        await sleep(2500);
      }
      await shot(`05-data-exported-${theme}`);
    }
    await js("window.__pupaDebug.setTab('Settings')");
    await sleep(6500); // scanner probe on macOS takes ~6 s
    await shot(`06-settings-${theme}`);
  }
  log.push({ final: await js("window.__pupaDebug.state()") });
  fs.writeFileSync(path.join(outDir, "tour-log.json"), JSON.stringify(log, null, 2));
  console.log("[tour] done");
  app.quit();
}

module.exports = { runTour };
