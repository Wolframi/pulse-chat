import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import paramiko

pw = os.environ.get("PULSE_SSH_PASS") or ""
if not pw:
    print("missing PULSE_SSH_PASS", file=sys.stderr)
    sys.exit(2)

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


def run(cmd: str, timeout: int = 90) -> tuple[int, str, str]:
    print(">>>", cmd)
    _stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out.rstrip())
    if err:
        print(err.rstrip())
    print("exit", code)
    print()
    return code, out, err


run("pm2 status")
run("pm2 logs pulse-chat --lines 40 --nostream")
run("ss -lntp | grep -E ':80|:443|:3000' || true")
run(
    "cd /root/pulse-chat && git log -1 --oneline && "
    "python3 -c \"import json; print('version', json.load(open('package.json')).get('version'))\""
)
run("curl -sS -m 5 http://127.0.0.1:3000/api/health || true")
run("pm2 restart pulse-chat || pm2 start /root/pulse-chat/ecosystem.config.cjs --only pulse-chat || pm2 start /root/pulse-chat/ecosystem.config.js --only pulse-chat")
run("sleep 3; pm2 status")
run("curl -sS -m 8 http://127.0.0.1:3000/api/health || true")
c.close()
