// Electron main process — single-window shell.
// Dev mode: loads the Vite dev server at http://localhost:5173 (or the built
// dist/ when PUPA_USE_DIST=1). Prod mode: loads the built dist/index.html.

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFile } = require("child_process");

const DEV = !app.isPackaged;
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

// Test hook: run against a throw-away data folder instead of the real one.
if (process.env.PUPA_USER_DATA) app.setPath("userData", process.env.PUPA_USER_DATA);

// --- Local Python pipeline paths -------------------------------------------
const DAEMON_ROOT_DEFAULT = path.resolve(__dirname, "..", "daemon");
const PIPELINE_ROOT = DEV
  ? DAEMON_ROOT_DEFAULT
  : path.join(process.resourcesPath, "python-pipeline");
const PYTHON_BIN_DEFAULT = DEV
  ? (IS_WIN
      ? path.join(DAEMON_ROOT_DEFAULT, ".venv", "Scripts", "python.exe")
      : path.join(DAEMON_ROOT_DEFAULT, ".venv", "bin", "python"))
  : path.join(PIPELINE_ROOT, "python-runtime", IS_WIN ? "python.exe" : "bin/python3");
const PYTHON_BIN = process.env.PUPA_PYTHON || PYTHON_BIN_DEFAULT;
const CNN_DAEMON_SCRIPT =
  process.env.PUPA_DAEMON || path.join(PIPELINE_ROOT, "pupa_counter_daemon.py");

// Model choice lives in daemon/model/manifest.json (file, classifier,
// trainDpi, thresholds). Only forward the env overrides the user set.
const DAEMON_ENV_KEYS = [
  "PUPA_MODEL_MANIFEST", "PUPA_MODEL_PATH", "PUPA_CLF_PATH", "PUPA_TRAIN_DPI",
  "PUPA_PEAK_THR", "PUPA_MIN_DIST", "PUPA_BBOX_CROP", "PUPA_BBOX_HEAT_THR",
  "PUPA_BBOX_PAD", "PUPA_CLF_PROB_THR",
];
const DAEMON_ENV = Object.fromEntries(
  DAEMON_ENV_KEYS.filter((k) => process.env[k]).map((k) => [k, process.env[k]])
);

// --- Data locations ---------------------------------------------------------
const USER_DATA = () => app.getPath("userData");
const SESSIONS_DIR = () => path.join(USER_DATA(), "sessions");
const SESSION_BACKUP_DIR = () => path.join(SESSIONS_DIR(), "_backup_before_v0.5");
const LEGACY_SESSION_PATH = () => path.join(USER_DATA(), "session.json");
const SCAN_OUT_DIR = () => path.join(USER_DATA(), "scans");
const DEFAULT_EXPORT_DIR = () =>
  process.env.PUPA_EXPORT_DIR || path.join(app.getPath("documents"), "Pupa Counter Exports");
const TOUR = !!process.env.PUPA_TOUR;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1200,
    minHeight: 720,
    titleBarStyle: "hiddenInset", // macOS: system traffic lights, no title text
    title: "Pupa Counter",
    backgroundColor: "#F5F4EF",
    show: !TOUR,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (TOUR) mainWindow.showInactive();
  if (DEV && process.env.PUPA_USE_DIST !== "1") {
    mainWindow.loadURL("http://localhost:5173");
    if (!process.env.PUPA_TOUR) mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  if (process.env.PUPA_TOUR) {
    mainWindow.webContents.once("did-finish-load", () => {
      require("./tour").runTour(mainWindow, process.env.PUPA_TOUR).catch((err) => {
        console.error("[tour] failed:", err);
      });
    });
  }
}

// --- Sessions ----------------------------------------------------------------
//
// Each session lives in <userData>/sessions/<sessionId>.json. The on-disk
// schema keeps the v0.4 key names (`rounds`, `roundId`, `roundNumber`) so
// older installs can still open files written by this version; the UI calls
// them "replicates". schemaVersion 2 marks files written by v0.5+.
// Before the first v0.5 write to a pre-v0.5 file we keep a copy of the
// original in sessions/_backup_before_v0.5/.

function safeId(id) {
  return String(id || "").replace(/[^A-Za-z0-9_\-]/g, "_").slice(0, 64) || "session";
}
function sessionFile(id) {
  return path.join(SESSIONS_DIR(), `${safeId(id)}.json`);
}
async function ensureDir(d) {
  await fs.promises.mkdir(d, { recursive: true });
}
function replicatesOf(data) {
  if (Array.isArray(data?.rounds)) return data.rounds;
  if (Array.isArray(data?.replicates)) return data.replicates;
  return [];
}

async function migrateLegacySessionOnce() {
  const legacy = LEGACY_SESSION_PATH();
  try {
    const raw = await fs.promises.readFile(legacy, "utf-8");
    const data = JSON.parse(raw);
    await ensureDir(SESSIONS_DIR());
    const id = data?.sessionId || `legacy_${new Date().toISOString().slice(0, 10)}`;
    const dest = sessionFile(id);
    if (!fs.existsSync(dest)) {
      await fs.promises.writeFile(dest, JSON.stringify(data, null, 2), "utf-8");
    }
    await fs.promises.rename(legacy, legacy + ".migrated");
  } catch {
    // No legacy file (or already migrated).
  }
}

ipcMain.handle("session:list", async () => {
  await ensureDir(SESSIONS_DIR());
  const files = (await fs.promises.readdir(SESSIONS_DIR())).filter((f) => f.endsWith(".json"));
  const out = (await Promise.all(files.map(async (f) => {
    const full = path.join(SESSIONS_DIR(), f);
    try {
      const [stat, raw] = await Promise.all([
        fs.promises.stat(full),
        fs.promises.readFile(full, "utf-8"),
      ]);
      const data = JSON.parse(raw);
      const reps = replicatesOf(data);
      return {
        sessionId: data.sessionId || f.replace(/\.json$/, ""),
        startedAt: data.startedAt || "",
        operator: data.operator || "",
        experiment: data.experiment || "",
        replicates: reps.length,
        scans: reps.reduce((a, r) => a + (Array.isArray(r.scans) ? r.scans.length : 0), 0),
        mtimeMs: stat.mtimeMs,
      };
    } catch {
      return null;
    }
  }))).filter(Boolean);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
});

ipcMain.handle("session:load", async (_evt, sessionId) => {
  await ensureDir(SESSIONS_DIR());
  if (!sessionId) {
    const files = await fs.promises.readdir(SESSIONS_DIR());
    let pick = null;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const full = path.join(SESSIONS_DIR(), f);
      const stat = await fs.promises.stat(full);
      if (!pick || stat.mtimeMs > pick.mtimeMs) pick = { full, mtimeMs: stat.mtimeMs };
    }
    if (!pick) return null;
    return JSON.parse(await fs.promises.readFile(pick.full, "utf-8"));
  }
  try {
    return JSON.parse(await fs.promises.readFile(sessionFile(sessionId), "utf-8"));
  } catch {
    return null;
  }
});

async function backupPreV05(file) {
  try {
    const raw = await fs.promises.readFile(file, "utf-8");
    const data = JSON.parse(raw);
    if (data && data.schemaVersion >= 2) return;
    await ensureDir(SESSION_BACKUP_DIR());
    const dest = path.join(SESSION_BACKUP_DIR(), path.basename(file));
    if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, raw, "utf-8");
  } catch {
    // File doesn't exist yet or isn't JSON; nothing to back up.
  }
}

// Writes go to a temp file first, then rename, so a crash mid-write
// can never leave a truncated session file behind.
// Saves for the same file are queued so two quick edits can never race.
const writeQueues = new Map();
let tmpCounter = 0;
async function atomicWrite(file, text) {
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const tmp = `${file}.tmp-${process.pid}-${++tmpCounter}`;
    await fs.promises.writeFile(tmp, text, "utf-8");
    await fs.promises.rename(tmp, file);
  });
  writeQueues.set(file, next);
  try { await next; } finally { if (writeQueues.get(file) === next) writeQueues.delete(file); }
}

// Remove half-written temp files left by a crash or forced quit.
async function cleanStaleTemps() {
  try {
    for (const f of await fs.promises.readdir(SESSIONS_DIR())) {
      if (/\.json\.tmp-/.test(f)) await fs.promises.unlink(path.join(SESSIONS_DIR(), f)).catch(() => {});
    }
  } catch { /* no sessions dir yet */ }
}

ipcMain.handle("session:save", async (_evt, data) => {
  await ensureDir(SESSIONS_DIR());
  if (!data?.sessionId) throw new Error("session:save requires data.sessionId");
  const file = sessionFile(data.sessionId);
  await backupPreV05(file);
  await atomicWrite(file, JSON.stringify(data, null, 2));
  return { ok: true, path: file, savedAt: Date.now() };
});

ipcMain.handle("session:create", async (_evt, partial) => {
  await ensureDir(SESSIONS_DIR());
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const id = safeId(partial?.sessionId || `sess_${stamp}`);
  const startedAt = partial?.startedAt || now.toLocaleString("sv-SE",
    { timeZone: "America/Los_Angeles" });
  const data = {
    schemaVersion: 2,
    sessionId: id,
    operator: partial?.operator || "",
    experiment: partial?.experiment || "",
    startedAt,
    rounds: [{ roundId: "r1", roundNumber: 1, startedAt, scans: [] }],
  };
  try {
    await fs.promises.writeFile(sessionFile(id),
      JSON.stringify(data, null, 2), { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const id2 = `${id}_${now.getMilliseconds()}`;
    data.sessionId = id2;
    await fs.promises.writeFile(sessionFile(id2),
      JSON.stringify(data, null, 2), { encoding: "utf-8", flag: "wx" });
  }
  return data;
});

// "Delete" moves the file to the OS trash so it can be recovered.
ipcMain.handle("session:delete", async (_evt, sessionId) => {
  if (!sessionId) return false;
  try {
    await shell.trashItem(sessionFile(sessionId));
    return true;
  } catch {
    return false;
  }
});

// --- Dialogs / files -----------------------------------------------------------

ipcMain.handle("dialog:openImage", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose a scan image",
    properties: ["openFile"],
    filters: [{ name: "Scans", extensions: ["png", "jpg", "jpeg", "tif", "tiff"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("dialog:openDirectory", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("file:readImageDataUrl", async (_evt, p) => {
  const buf = await fs.promises.readFile(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime =
    ext === "png" ? "image/png"
    : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "webp" ? "image/webp"
    : "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
});

ipcMain.handle("file:exists", async (_evt, p) => {
  try { await fs.promises.access(p); return true; } catch { return false; }
});

const DEMO_DIR =
  process.env.PUPA_DEMO_DIR || path.join(os.homedir(), "Downloads", "pupate_batch");
ipcMain.handle("file:listDemoScans", async () => {
  try {
    const files = await fs.promises.readdir(DEMO_DIR);
    return files.filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().slice(0, 100)
      .map((f) => path.join(DEMO_DIR, f));
  } catch {
    return [];
  }
});

// --- Paths, export, shell --------------------------------------------------------

ipcMain.handle("app:paths", async () => ({
  userData: USER_DATA(),
  sessions: SESSIONS_DIR(),
  sessionBackups: SESSION_BACKUP_DIR(),
  scans: SCAN_OUT_DIR(),
  exportsDefault: DEFAULT_EXPORT_DIR(),
  platform: process.platform,
  version: app.getVersion(),
}));

async function resolveExportDir(requested) {
  const dir = requested || DEFAULT_EXPORT_DIR();
  try {
    await ensureDir(dir);
    return dir;
  } catch {
    const fb = DEFAULT_EXPORT_DIR();
    await ensureDir(fb);
    return fb;
  }
}

function safeFileName(name) {
  return String(name || "export").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 150);
}

ipcMain.handle("export:text", async (_evt, { dir, filename, content, bom = true }) => {
  const outDir = await resolveExportDir(dir);
  const file = path.join(outDir, safeFileName(filename));
  await fs.promises.writeFile(file, (bom ? "﻿" : "") + content, "utf-8");
  return file;
});

ipcMain.handle("export:xlsx", async (_evt, { dir, filename, sheets }) => {
  const outDir = await resolveExportDir(dir);
  const file = path.join(outDir, safeFileName(filename));
  await cnnRequest({ cmd: "export_xlsx", path: file, sheets });
  return file;
});

ipcMain.handle("shell:showItemInFolder", async (_evt, p) => {
  if (TOUR) { console.log(`[tour] would show in folder: ${p}`); return true; }
  if (p) shell.showItemInFolder(p);
  return true;
});

ipcMain.handle("shell:openPath", async (_evt, p) => {
  if (!p) return "no path";
  if (TOUR) { console.log(`[tour] would open: ${p}`); return ""; }
  await ensureDir(p).catch(() => {});
  return shell.openPath(p);
});

// --- CNN worker (persistent Python daemon) ----------------------------------------

const cnnWorker = {
  proc: null,
  starting: null,
  nextId: 1,
  pending: new Map(),
  stdoutBuf: "",
  info: null,
  lastError: null,
};

function startCnnWorker() {
  if (cnnWorker.proc && cnnWorker.info) return Promise.resolve();
  if (cnnWorker.starting) return cnnWorker.starting;

  cnnWorker.starting = new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(PYTHON_BIN, [CNN_DAEMON_SCRIPT], {
        cwd: path.dirname(CNN_DAEMON_SCRIPT),
        env: { ...process.env, ...DAEMON_ENV, PYTHONUNBUFFERED: "1" },
      });
    } catch (err) {
      cnnWorker.starting = null;
      return reject(err);
    }
    cnnWorker.proc = proc;
    let readyHandled = false;

    proc.stdout.on("data", (d) => {
      cnnWorker.stdoutBuf += d.toString();
      let nl;
      while ((nl = cnnWorker.stdoutBuf.indexOf("\n")) !== -1) {
        const line = cnnWorker.stdoutBuf.slice(0, nl).trim();
        cnnWorker.stdoutBuf = cnnWorker.stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch {
          console.warn("[cnn-worker] non-JSON stdout line:", line);
          continue;
        }
        if (!readyHandled && msg && "ready" in msg) {
          readyHandled = true;
          if (msg.ready) {
            cnnWorker.info = msg;
            cnnWorker.lastError = null;
            console.log(`[cnn-worker] ready on ${msg.deviceName || msg.device} · model=${msg.model} · trainDpi=${msg.trainDpi}`);
            resolve();
          } else {
            cnnWorker.lastError = msg.error || "daemon failed to start";
            reject(new Error(cnnWorker.lastError));
          }
        } else {
          dispatch(msg);
        }
      }
    });

    proc.stderr.on("data", (d) => {
      for (const line of d.toString().split("\n")) if (line.trim()) console.warn(`[cnn-worker stderr] ${line}`);
    });

    proc.on("error", (err) => {
      console.error("[cnn-worker] spawn error:", err);
      cnnWorker.lastError = `Could not start Python (${PYTHON_BIN}): ${err.message}`;
      failAllPending(err);
      cnnWorker.proc = null;
      cnnWorker.info = null;
      cnnWorker.starting = null;
      if (!readyHandled) reject(new Error(cnnWorker.lastError));
    });

    proc.on("close", (code) => {
      console.warn(`[cnn-worker] exited with code ${code}`);
      failAllPending(new Error(`cnn worker exited (${code})`));
      cnnWorker.proc = null;
      cnnWorker.info = null;
      cnnWorker.starting = null;
      if (!readyHandled) reject(new Error(cnnWorker.lastError || `cnn worker exited (${code})`));
    });
  }).finally(() => { cnnWorker.starting = null; });
  return cnnWorker.starting;
}

function dispatch(msg) {
  if (!msg || msg.id == null) return;
  const cb = cnnWorker.pending.get(msg.id);
  if (!cb) return;
  cnnWorker.pending.delete(msg.id);
  if (msg.ok) cb.resolve(msg.result);
  else cb.reject(new Error(msg.error || "cnn worker error"));
}

function failAllPending(err) {
  for (const [, cb] of cnnWorker.pending) cb.reject(err);
  cnnWorker.pending.clear();
}

async function cnnRequest(payload) {
  await startCnnWorker();
  return new Promise((resolve, reject) => {
    const id = cnnWorker.nextId++;
    cnnWorker.pending.set(id, { resolve, reject });
    try {
      cnnWorker.proc.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
    } catch (err) {
      cnnWorker.pending.delete(id);
      reject(err);
    }
  });
}

ipcMain.handle("cnn:detect", async (_evt, imagePath, opts) =>
  cnnRequest({ cmd: "detect", imagePath, dpi: opts?.dpi ?? null }));

ipcMain.handle("cnn:info", async () => {
  try {
    await startCnnWorker();
    return cnnWorker.info;
  } catch (err) {
    return { ready: false, error: err.message };
  }
});

app.on("before-quit", () => {
  if (cnnWorker.proc) {
    try { cnnWorker.proc.stdin.write(JSON.stringify({ id: 0, cmd: "quit" }) + "\n"); } catch {}
    try { cnnWorker.proc.kill(); } catch {}
  }
});

// --- Scanner ------------------------------------------------------------------------
//
// Windows: WIA through PowerShell (electron/scanner/*.ps1).
// macOS:   ImageCaptureCore through the small Swift CLI electron/scanner/mac/icscan.
// Both return one JSON line; we normalise to
//   {ok, path, width, height, requestedDpi, actualDpi, dpiSource, mode, warnings}

const SCANNER_DIR = path.join(__dirname, "scanner").replace(
  `${path.sep}app.asar${path.sep}`,
  `${path.sep}app.asar.unpacked${path.sep}`,
);

const STANDARD_DPIS = [75, 100, 150, 200, 240, 300, 400, 600, 1200, 2400];
const BED_WIDTHS_IN = [8.27, 8.5];
const BED_HEIGHTS_IN = [11.69, 11.7];

function snapDpi(v, tol = 0.04) {
  let best = STANDARD_DPIS[0];
  for (const d of STANDARD_DPIS) if (Math.abs(d - v) < Math.abs(best - v)) best = d;
  return Math.abs(best - v) <= tol * best ? best : null;
}

// DPI the image really has, from its pixel size (A4 window or full LiDE bed).
function inferDpiFromSize(w, h) {
  for (const bw of BED_WIDTHS_IN) {
    const d = snapDpi(w / bw);
    if (!d) continue;
    if (BED_HEIGHTS_IN.some((bh) => Math.abs(h - bh * d) <= 0.03 * bh * d)) return d;
  }
  return null;
}

function runJsonProcess(cmd, args, { timeoutMs = 180000, label = cmd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      let parsed;
      try { parsed = JSON.parse(lastLine); } catch {
        return reject(new Error(`${label} produced no JSON (exit ${code}). ${stderr.trim() || ""}`.trim()));
      }
      if (parsed.ok === false) return reject(new Error(parsed.error || `${label} failed`));
      if (stderr.trim()) parsed._stderr = stderr.trim();
      resolve(parsed);
    });
  });
}

// --- macOS: icscan binary ---------------------------------------------------------

const ICSCAN_SRC = path.join(SCANNER_DIR, "mac", "icscan.swift");
let icscanPromise = null;

function newerThan(a, b) {
  try { return fs.statSync(a).mtimeMs >= fs.statSync(b).mtimeMs; } catch { return false; }
}

function compileIcscan(out) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFile("xcrun", ["swiftc", "-O", ICSCAN_SRC, "-o", out], { timeout: 240000 }, (err, _so, se) => {
      if (err) return reject(new Error(`swiftc failed: ${se || err.message}. Install Xcode Command Line Tools (xcode-select --install) or run "npm run build:icscan".`));
      resolve(out);
    });
  });
}

function getIcscan() {
  if (icscanPromise) return icscanPromise;
  icscanPromise = (async () => {
    if (process.env.PUPA_ICSCAN) return process.env.PUPA_ICSCAN;
    if (!DEV) {
      const packaged = path.join(process.resourcesPath, "icscan");
      if (fs.existsSync(packaged)) return packaged;
    }
    const repoBin = path.join(SCANNER_DIR, "mac", "bin", "icscan");
    if (fs.existsSync(repoBin) && newerThan(repoBin, ICSCAN_SRC)) return repoBin;
    const userBin = path.join(USER_DATA(), "bin", "icscan");
    if (fs.existsSync(userBin) && newerThan(userBin, ICSCAN_SRC)) return userBin;
    console.log("[scanner] compiling icscan →", userBin);
    return compileIcscan(userBin);
  })().catch((err) => { icscanPromise = null; throw err; });
  return icscanPromise;
}

async function macListDevices() {
  const bin = await getIcscan();
  const res = await runJsonProcess(bin, ["list"], { timeoutMs: 20000, label: "icscan list" });
  return (res.devices || []).map((d) => ({
    id: d.id || d.name,
    name: d.name || "Scanner",
    description: "ImageCaptureCore",
    manufacturer: "",
  }));
}

async function macScan({ outPath, dpi, mode }) {
  const bin = await getIcscan();
  const args = ["scan", outPath, String(dpi)];
  if (mode === "grayscale") args.push("gray");
  const res = await runJsonProcess(bin, args, { timeoutMs: 240000, label: "icscan scan" });
  let fromBed = null;
  if (res.physicalWidthIn > 0 && res.width > 0) fromBed = snapDpi(res.width / res.physicalWidthIn, 0.03);
  return {
    ...res,
    reportedDpi: res.dpi,
    actualDpi: fromBed || inferDpiFromSize(res.width, res.height) || res.dpi,
    dpiSource: fromBed ? "pixels / bed size" : "pixel size",
  };
}

// --- Windows: WIA -------------------------------------------------------------------

function runPs(scriptName, args) {
  const scriptPath = path.join(SCANNER_DIR, scriptName);
  return runJsonProcess(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
    { timeoutMs: 240000, label: scriptName }
  );
}

async function winListDevices() {
  const res = await runPs("wia_list.ps1", []);
  return res.devices || [];
}

async function winScan({ deviceId, outPath, dpi, mode }) {
  const res = await runPs("wia_scan.ps1", [
    "-DeviceId", deviceId, "-OutPath", outPath, "-Dpi", String(dpi), "-Mode", mode,
  ]);
  const fromSize = inferDpiFromSize(res.width, res.height);
  return {
    ...res,
    actualDpi: fromSize || res.actualDpi || res.dpi,
    dpiSource: fromSize ? "pixel size" : "driver",
  };
}

ipcMain.handle("scanner:listDevices", async () => {
  if (IS_WIN) return winListDevices();
  if (IS_MAC) return macListDevices();
  throw new Error("Scanning is supported on Windows (WIA) and macOS (ImageCaptureCore).");
});

ipcMain.handle("scanner:scan", async (_evt, params) => {
  const { deviceId, dpi = 300, mode = "color", outDir: requestedDir } = params || {};
  if (IS_WIN && !deviceId) throw new Error("scanner:scan requires deviceId");
  const fallback = SCAN_OUT_DIR();
  let outDir = requestedDir || fallback;
  try {
    await ensureDir(outDir);
  } catch (err) {
    console.warn(`[scanner] save dir ${outDir} unusable (${err.message}); falling back to ${fallback}`);
    outDir = fallback;
    await ensureDir(outDir);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `scan_${stamp}.png`);
  const res = IS_WIN
    ? await winScan({ deviceId, outPath, dpi, mode })
    : IS_MAC
      ? await macScan({ outPath, dpi, mode })
      : (() => { throw new Error("Scanning is not supported on this platform."); })();
  const out = {
    ok: true,
    path: res.path || outPath,
    width: res.width,
    height: res.height,
    requestedDpi: dpi,
    actualDpi: res.actualDpi,
    dpiSource: res.dpiSource,
    mode: res.mode || mode,
    warnings: res.warnings || [],
    backend: IS_WIN ? "wia" : "imagecapture",
  };
  console.log(`[scanner] ${out.backend} ${out.width}x${out.height} requested=${dpi} actual=${out.actualDpi}`);
  return out;
});

// --- Lifecycle ----------------------------------------------------------------------

app.whenReady().then(async () => {
  await cleanStaleTemps();
  await migrateLegacySessionOnce().catch((err) => {
    console.warn("[session] legacy migration failed:", err.message);
  });
  createWindow();
  startCnnWorker().catch((err) => {
    console.warn("[cnn-worker] pre-warm failed:", err.message);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || process.env.PUPA_TOUR) app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
