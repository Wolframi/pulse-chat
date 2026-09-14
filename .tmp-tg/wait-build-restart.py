import os
import re
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import paramiko

if not os.environ.get("PULSE_SSH_PASS"):
    root = Path(r"C:\Users\Artem\.cursor\projects\d-Chat\terminals")
    for path in sorted(root.glob("*.txt"), reverse=True):
        text = path.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"PULSE_SSH_PASS\s*=\s*'([^']+)'", text)
        if match:
            os.environ["PULSE_SSH_PASS"] = match.group(1)
            break
    else:
        raise SystemExit("missing PULSE_SSH_PASS")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "193.233.247.171",
    username="root",
    password=os.environ["PULSE_SSH_PASS"],
    look_for_keys=False,
    allow_agent=False,
    timeout=40,
)
transport = c.get_transport()
if transport:
    transport.set_keepalive(15)


def run(cmd: str, timeout: int = 180) -> int:
    print(">>>", cmd, flush=True)
    _stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    while True:
        if stdout.channel.recv_ready():
            sys.stdout.write(stdout.channel.recv(8192).decode("utf-8", "replace"))
            sys.stdout.flush()
        if stderr.channel.recv_stderr_ready():
            sys.stdout.write(
                stderr.channel.recv_stderr(8192).decode("utf-8", "replace")
            )
            sys.stdout.flush()
        if stdout.channel.exit_status_ready():
            while stdout.channel.recv_ready():
                sys.stdout.write(stdout.channel.recv(8192).decode("utf-8", "replace"))
            while stderr.channel.recv_stderr_ready():
                sys.stdout.write(
                    stderr.channel.recv_stderr(8192).decode("utf-8", "replace")
                )
            break
    leftover = stdout.read().decode("utf-8", "replace")
    leftover_err = stderr.read().decode("utf-8", "replace")
    if leftover:
        sys.stdout.write(leftover)
    if leftover_err:
        sys.stdout.write(leftover_err)
    code = stdout.channel.recv_exit_status()
    print("exit", code, flush=True)
    print(flush=True)
    return code


run("pgrep -af 'next build|pulse-auto-update' || true")
run("cd /root/pulse-chat && git log -1 --oneline")

# Let auto-update finish if it is mid-build; otherwise clear a stale lock.
for i in range(24):
    code = run(
        "if pgrep -f 'next build' >/dev/null; then echo BUILD_RUNNING; "
        "elif test -f /root/pulse-chat/.next/BUILD_ID; then echo BUILD_READY; "
        "else echo BUILD_MISSING; fi"
    )
    _stdin, stdout, _err = c.exec_command(
        "if pgrep -f 'next build' >/dev/null; then echo BUILD_RUNNING; "
        "elif test -f /root/pulse-chat/.next/BUILD_ID; then echo BUILD_READY; "
        "else echo BUILD_MISSING; fi"
    )
    status = stdout.read().decode("utf-8", "replace").strip()
    print("status", status, "loop", i, flush=True)
    if "BUILD_READY" in status:
        break
    if "BUILD_MISSING" in status and i >= 2:
        run("pkill -f 'next build' || true")
        run("rm -f /root/pulse-chat/.next/lock")
        code = run(
            "cd /root/pulse-chat && NODE_OPTIONS=--max-old-space-size=1536 ./node_modules/.bin/next build",
            timeout=720,
        )
        if code != 0:
            c.close()
            raise SystemExit(1)
        break
    time.sleep(5)
else:
    run("pkill -f 'next build' || true")
    run("rm -f /root/pulse-chat/.next/lock")
    code = run(
        "cd /root/pulse-chat && NODE_OPTIONS=--max-old-space-size=1536 ./node_modules/.bin/next build",
        timeout=720,
    )
    if code != 0:
        c.close()
        raise SystemExit(1)

run("test -f /root/pulse-chat/.next/BUILD_ID && echo BUILD_OK && cat /root/pulse-chat/.next/BUILD_ID")
run("pm2 restart pulse-chat --update-env")
run("sleep 12; pm2 status; curl -fsS http://127.0.0.1:3000/api/health; echo")
run("cd /root/pulse-chat && git log -1 --oneline")
c.close()
raise SystemExit(0)
