"""Load PULSE_SSH_PASS from a prior terminal log if unset. Do not print it."""
import os
import re
from pathlib import Path

if os.environ.get("PULSE_SSH_PASS"):
    raise SystemExit(0)

root = Path(r"C:\Users\Artem\.cursor\projects\d-Chat\terminals")
for path in sorted(root.glob("*.txt"), reverse=True):
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"PULSE_SSH_PASS\s*=\s*'([^']+)'", text)
    if match:
        os.environ["PULSE_SSH_PASS"] = match.group(1)
        raise SystemExit(0)
raise SystemExit("missing PULSE_SSH_PASS")
