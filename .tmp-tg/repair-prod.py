import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import paramiko

pw = os.environ.get("PULSE_SSH_PASS") or ""
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "193.233.247.171",
    username="root",
    password=pw,
    look_for_keys=False,
    allow_agent=False,
    timeout=25,
    banner_timeout=25,
    auth_timeout=25,
)


def run(cmd: str, timeout: int = 120) -> tuple[int, str]:
    print(">>>", cmd, flush=True)
    _stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    text = (out + ("\n" + err if err else "")).rstrip()
    if text:
        print(text)
    print("exit", code, flush=True)
    print(flush=True)
    return code, text


run("df -h / /root; du -sh /root/pulse-chat /root/pulse-chat/node_modules /root/pulse-chat/.next 2>/dev/null || true")
run("ls -ld /root/pulse-chat/node_modules /root/pulse-chat/node_modules/next 2>&1 | head")
run("pm2 stop pulse-chat")
code, _ = run(
    "cd /root/pulse-chat && npm ci --omit=dev=false",
    timeout=600,
)
if code != 0:
    print("npm ci failed, trying npm install")
    run("cd /root/pulse-chat && npm install", timeout=600)
run("test -d /root/pulse-chat/.next && echo HAS_NEXT_BUILD || echo NO_NEXT_BUILD")
run("cd /root/pulse-chat && npm run build", timeout=600)
run("pm2 restart pulse-chat")
run("sleep 5; pm2 status")
run("curl -sS -m 10 http://127.0.0.1:3000/api/health || true")
c.close()
