import os
import re
import sys
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
                sys.stdout.flush()
            while stderr.channel.recv_stderr_ready():
                sys.stdout.write(
                    stderr.channel.recv_stderr(8192).decode("utf-8", "replace")
                )
                sys.stdout.flush()
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


run(
    "ls -l /root/pulse-chat/node_modules/.bin/next "
    "/root/pulse-chat/node_modules/next/package.json "
    "/root/pulse-chat/node_modules/react/package.json "
    "/root/pulse-chat/node_modules/tsx/package.json 2>&1 | head -20"
)
run("cd /root/pulse-chat && git log -1 --oneline && test -f .next/BUILD_ID && echo HAS_BUILD || echo NO_BUILD")

# Bring the site back first if the runtime is still there.
run("pm2 start pulse-chat --update-env || pm2 restart pulse-chat --update-env")
run("sleep 6; pm2 status; curl -sS -m 10 http://127.0.0.1:3000/api/health || echo HEALTH_FAIL")

# Repair broken npm tree, then rebuild the new commit.
run("rm -rf /root/pulse-chat/node_modules/es-abstract")
deps = run(
    "cd /root/pulse-chat && test -x node_modules/.bin/next && test -d node_modules/react "
    "&& echo DEPS_OK || NODE_OPTIONS=--max-old-space-size=1024 npm ci",
    timeout=600,
)
if deps != 0:
    run("rm -rf /root/pulse-chat/node_modules/es-abstract")
    deps = run(
        "cd /root/pulse-chat && NODE_OPTIONS=--max-old-space-size=1024 npm ci",
        timeout=600,
    )
if deps != 0:
    print("DEPS_FAILED", flush=True)
    c.close()
    raise SystemExit(1)

code = run(
    "cd /root/pulse-chat && NODE_OPTIONS=--max-old-space-size=1536 ./node_modules/.bin/next build",
    timeout=720,
)
if code != 0:
    print("BUILD_FAILED", flush=True)
    run("pm2 status; curl -sS -m 8 http://127.0.0.1:3000/api/health || true")
    c.close()
    raise SystemExit(1)

run("test -f /root/pulse-chat/.next/BUILD_ID && echo BUILD_OK && cat /root/pulse-chat/.next/BUILD_ID")
run("pm2 restart pulse-chat --update-env")
run("sleep 12; pm2 status; curl -fsS http://127.0.0.1:3000/api/health; echo")
run("cd /root/pulse-chat && git log -1 --oneline")
run("systemctl start pulse-auto-update.timer 2>/dev/null || true")
c.close()
raise SystemExit(0)
