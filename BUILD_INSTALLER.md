# Building the Windows installer

This doc is for the maintainer (you) standing in front of the Windows lab
machine. Goal: produce `Pupa Counter Setup <version>.exe` and upload it
to the matching GitHub release. End-to-end ~10 minutes once the
prerequisites are in place.

**Why only Windows can build it:** the installer embeds a pre-built
`python-runtime/` tree (~900 MB) containing Python 3.11.9 + torch+xpu +
opencv + sklearn + Intel oneAPI DLLs. That tree was assembled by hand on
the lab Windows box and lives on its disk — it's not in this repo (too
large) and it's not in CI (no Windows runner). So the .exe step happens
locally on the lab machine.

macOS / Linux can build their own `.dmg` / `.AppImage` via
`npm run package:mac`, but those targets use the dev `.venv` and aren't
self-contained — they're for testing only.

---

## Prerequisites (one-time per machine)

1. **Node 20+ + npm.** Already installed on the lab machine; `node -v`
   to confirm.
2. **Git + GitHub CLI** (`gh`). `gh auth status` should show you
   logged into `sgaofen`.
3. **The `python-runtime/` tree.** On the lab machine this is at
   `C:\Users\<you>\Documents\pupa_counter_v6\python-runtime\` from the
   v0.3.x era. It contains the embedded Python + pruned site-packages.

   **Move (or symlink) it to the new monorepo location** — the
   2026-05-18 consolidation changed the path electron-builder reads:

   ```powershell
   # PowerShell (run as admin if symlink)
   Move-Item C:\Users\<you>\Documents\pupa_counter_v6\python-runtime `
             C:\Users\<you>\Documents\pupa-counter\daemon\python-runtime
   ```

   Or, if you want to keep `pupa_counter_v6\` intact as an archive:

   ```powershell
   New-Item -ItemType SymbolicLink `
     -Path   C:\Users\<you>\Documents\pupa-counter\daemon\python-runtime `
     -Target C:\Users\<you>\Documents\pupa_counter_v6\python-runtime
   ```

   Verify: `dir daemon\python-runtime\python.exe` should exist.

4. **electron-builder cache** is auto-populated on first run; no manual
   step. It downloads NSIS + winCodeSign on demand to
   `%LOCALAPPDATA%\electron-builder\Cache\`.

---

## Building a new installer

From `C:\Users\<you>\Documents\pupa-counter\`:

```powershell
git pull                                # latest main
npm ci                                  # clean install of node deps (~2 min)
npm run build                           # tsc + vite → dist/  (~20 sec)
npm run package:win                     # NSIS bundle → release/  (~5 min)
```

Output: `release\Pupa Counter Setup <version>.exe` (~1.1 GB).
The version comes from `package.json`'s `version` field — bump it
*before* running `npm run package:win` if you're cutting a new release.

**Sanity-check the .exe locally before uploading:**

1. Double-click `release\Pupa Counter Setup <version>.exe`.
2. Install to the default location, launch.
3. Drag any 300 dpi LiDE PNG onto the canvas. Detection should
   complete in ~1 s and you should see green dots.
4. The MOCK badge must **not** appear — that means the Python daemon
   started cleanly with the bundled runtime.
5. Click **Save to database**, restart the app, confirm the scan is
   still there (sessions persist under `%APPDATA%\Pupa Counter\sessions\`).

If MOCK appears or detection fails, look at the DevTools console (the
packaged build opens it automatically if you ran `npm run dev` first to
warm up; otherwise see `%APPDATA%\Pupa Counter\logs\`).

---

## Uploading to the GitHub release

Replace `<version>` with the actual version (e.g. `0.4.0`):

```powershell
gh release upload v<version> "release\Pupa Counter Setup <version>.exe" `
    --clobber
```

`--clobber` overwrites any prior upload with the same filename (useful
if you're iterating on a release that hasn't been "published" to users
yet). If you bump the version mid-release, upload under the new name
and delete the stale one with `gh release delete-asset v<version>
<old-name>`.

After upload, double-check on the web UI:
- File size matches local (`dir release\` vs the release page)
- SHA256 matches what `Get-FileHash release\...exe` reports

---

## Releasing a new version (full checklist)

1. On dev machine (Mac / wherever):
   ```bash
   # In pupa-counter/
   # 1. bump package.json version (semver)
   # 2. commit, push
   git add package.json && git commit -m "Bump to v0.5.0"
   git push
   # 3. tag + push tag
   git tag v0.5.0
   git push --tags
   # 4. create the GitHub release (draft until .exe is up)
   gh release create v0.5.0 --title "v0.5.0 — <one-liner>" \
       --notes-file RELEASE_NOTES_0.5.0.md --draft
   ```

2. On lab Windows machine:
   ```powershell
   git pull
   npm ci && npm run build && npm run package:win
   gh release upload v0.5.0 "release\Pupa Counter Setup 0.5.0.exe"
   ```

3. Back on dev machine: `gh release edit v0.5.0 --draft=false` to
   publish (or click "publish" in the web UI).

---

## What old installs do when a new .exe is installed

NSIS upgrades in place: same install path, app files replaced, user
data preserved. The relevant settings in `package.json`:

```json
"nsis": {
  "oneClick": false,                       // show install wizard
  "perMachine": false,                     // install per-user
  "allowToChangeInstallationDirectory": true,
  "deleteAppDataOnUninstall": false        // preserve sessions on upgrade
}
```

User's saved scans (`%APPDATA%\Pupa Counter\sessions\*.json`,
`%APPDATA%\Pupa Counter\scans\*.png`) are NOT touched by
install / uninstall / upgrade. They persist until the user manually
deletes that folder.

**A user on v0.3.1 who wants v0.4.0:**
1. Download `Pupa Counter Setup 0.4.0.exe` from the release page.
2. Run it. NSIS detects v0.3.1, replaces app files (Python runtime,
   model weights, app code), keeps user data.
3. Launch — they now get the v3 model (109-scan trained) automatically.
   Their session history is intact.

**There is no auto-update.** Users have to know to download the new
installer. If you want auto-update in the future, see
`electron-updater` — it's the standard add-on but requires either code
signing ($100/yr cert) or accepting that Windows SmartScreen will
prompt users on each update.

---

## Quick-update path (model swap only, ~50 MB)

If you've just retrained the CNN and want existing installs on the v3
.exe to get the new weights without a full re-install:

1. Drop new `pupa_counter_lide300.pt` + `peak_filter_clf_lide300.pkl`
   into a small zip.
2. User extracts them into
   `C:\Users\<user>\AppData\Local\Programs\Pupa Counter\resources\python-pipeline\model\`
   (overwriting).
3. Restart the app — daemon reloads the new weights on next start.

This bypasses the 1.1 GB installer entirely. Good for "v3.1" type
model-only iterations where the inference code didn't change.

---

## Recreating `python-runtime/` from scratch (rare)

If the hand-built tree is lost (lab machine reformat, disk crash), it
has to be rebuilt by hand. The recipe documented in commit
`c464a37` (v0.3.0):

1. Download `python-3.11.9-embed-amd64.zip` from python.org → extract
   to `daemon/python-runtime/`.
2. Edit `python311._pth` to add `Lib/site-packages` (one line —
   uncomment the import statement near the bottom).
3. From a regular dev `.venv` that already has torch+xpu, opencv,
   sklearn, scikit-image, scipy, sympy, numpy installed (use
   `daemon/scripts/setup_venv.py` to bootstrap it), copy:
   - `.venv\Lib\site-packages\*`  → `python-runtime\Lib\site-packages\`
   - `.venv\Library\*`            → `python-runtime\Library\` (Intel oneAPI DLLs)
4. **Prune** to keep size under 1 GB:
   - Delete `Lib\site-packages\triton\` (1.9 GB, not used in our XPU path)
   - Delete `Lib\site-packages\matplotlib\` (only needed at training, not inference)
   - Delete any `~orch\` half-removed leftover dirs
   - Delete `pip\`, `setuptools\`, `wheel\`, `_distutils_hack\`, `pkg_resources\`
5. Smoke test:
   ```powershell
   .\python-runtime\python.exe -c "import torch, cv2, sklearn, skimage; print('ok')"
   ```
   If that prints `ok`, you're good — proceed with `npm run package:win`.

This is a 1-2 hour exercise. Don't do it unless you have to.
