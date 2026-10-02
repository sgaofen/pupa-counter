#!/bin/zsh
# Launch Pupa Counter on this Mac without packaging it.
#  - rebuilds the UI first if any source file is newer than dist/
#  - uses daemon/.venv (symlink to the lab venv) for the Python daemon
#  - appends all main-process / daemon / renderer-error output to a daily log
REPO="${0:A:h:h}"
export PATH="$HOME/tools/nodejs/bin:$PATH"
LOGDIR="$HOME/Library/Logs/PupaCounter"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/pupa-$(date +%F).log"
cd "$REPO" || exit 1
{
  echo "===== launch $(date '+%F %T')  commit $(git rev-parse --short HEAD 2>/dev/null) ====="
  if [[ ! -f dist/index.html ]] || [[ -n "$(find src index.html -newer dist/index.html -print -quit 2>/dev/null)" ]]; then
    echo "[launcher] UI sources changed -> npm run build"
    npm run build || { echo "[launcher] build failed"; osascript -e 'display alert "Pupa Counter" message "UI build failed - see ~/Library/Logs/PupaCounter"'; exit 1; }
  fi
} >> "$LOG" 2>&1
PUPA_USE_DIST=1 exec ./node_modules/.bin/electron . >> "$LOG" 2>&1
