import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "193.233.247.171",
    username="root",
    password=os.environ["PULSE_SSH_PASS"],
    look_for_keys=False,
    allow_agent=False,
    timeout=25,
    banner_timeout=25,
    auth_timeout=25,
)


def run(cmd: str, timeout: int = 90) -> tuple[int, str]:
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


run("uptime; free -m | head -n 2; df -h / | tail -n 1")
run("pm2 status")
code, _ = run(
    "test -f /root/pulse-chat/node_modules/next/package.json && echo NEXT_OK || echo NEXT_MISSING; "
    "test -f /root/pulse-chat/.next/BUILD_ID && echo BUILD_OK || echo BUILD_MISSING; "
    "cd /root/pulse-chat && git log -1 --oneline && python3 -c \"import json; print(json.load(open('package.json')).get('version'))\""
)
code, out = run(
    "test -f /root/pulse-chat/node_modules/next/package.json; echo $?"
)
need_install = "NEXT_MISSING" in out or True

# decide install from previous output by re-checking
code, check = run(
    "if test -f /root/pulse-chat/node_modules/next/package.json; then echo NEXT_OK; else echo NEXT_MISSING; fi"
)
if "NEXT_MISSING" in check:
    print("installing dependencies", flush=True)
    code, _ = run("cd /root/pulse-chat && npm ci", timeout=700)
    if code != 0:
        run("cd /root/pulse-chat && npm install", timeout=700)

code, check = run(
    "if test -f /root/pulse-chat/.next/BUILD_ID; then echo BUILD_OK; else echo BUILD_MISSING; fi"
)
if "BUILD_MISSING" in check:
    run("cd /root/pulse-chat && npm run build", timeout=700)

run("pm2 start pulse-chat || pm2 restart pulse-chat")
run("sleep 6; pm2 status")
run("curl -sS -m 10 http://127.0.0.1:3000/api/health || true")
run("pm2 logs pulse-chat --lines 20 --nostream")
c.close()
