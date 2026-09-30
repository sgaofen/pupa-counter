"""Windows smoke test for the Python daemon (run by CI).

Starts pupa_counter_daemon.py exactly like Electron does (JSON lines on
stdin/stdout), checks that it comes up with the v5 + stage-2 model, runs one
detection on the bundled example scan and compares the count with the value
produced on macOS (same weights, CPU/MPS numerics may differ by a pupa or two).
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = 197      # macOS reference for daemon/examples/example_scan.png
TOLERANCE = 3

p = subprocess.Popen([sys.executable, str(ROOT / "daemon" / "pupa_counter_daemon.py")],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=ROOT)
ready = json.loads(p.stdout.readline())
print("ready:", ready)
assert ready.get("ready"), ready
assert ready.get("classifier") == "stage2_clf_v5.pkl", ready

img = str(ROOT / "daemon" / "examples" / "example_scan.png")
p.stdin.write(json.dumps({"id": 1, "cmd": "detect", "imagePath": img}) + "\n")
p.stdin.flush()
resp = json.loads(p.stdout.readline())
assert resp.get("ok"), resp
n = len(resp["result"]["pupae"])
print("pupae:", n, "sheet:", resp["result"].get("sheet", {}).get("found"))
p.stdin.write(json.dumps({"id": 2, "cmd": "quit"}) + "\n")
p.stdin.flush()
p.wait(timeout=60)
assert abs(n - EXPECTED) <= TOLERANCE, f"count {n} differs from macOS reference {EXPECTED}"
print("OK")
