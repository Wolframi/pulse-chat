import os
import socket
import sys

import paramiko

pw = os.environ.get("PULSE_SSH_PASS") or ""
if not pw:
    print("missing PULSE_SSH_PASS", file=sys.stderr)
    sys.exit(2)

host = "193.233.247.171"
print("tcp", end=" ", flush=True)
s = socket.create_connection((host, 22), timeout=8)
banner = s.recv(128)
print("ok", banner[:80])
s.close()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    c.connect(
        host,
        username="root",
        password=pw,
        look_for_keys=False,
        allow_agent=False,
        timeout=20,
        banner_timeout=20,
        auth_timeout=20,
        disabled_algorithms={"pubkeys": ["rsa-sha2-256", "rsa-sha2-512"]},
    )
except Exception as e:
    print("ssh connect failed:", type(e).__name__, e)
    sys.exit(1)


def run(cmd: str) -> None:
    print(">>>", cmd)
    _stdin, stdout, stderr = c.exec_command(cmd, timeout=90)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out.rstrip())
    if err:
        print(err.rstrip())
    print("exit", code)
    print()


run("pm2 status")
run("pm2 logs pulse-chat --lines 50 --nostream")
run("curl -sS -m 8 http://127.0.0.1:3000/api/health || true")
run(
    "cd /root/pulse-chat && git log -1 --oneline && "
    "python3 -c \"import json; print('version', json.load(open('package.json')).get('version'))\""
)
c.close()
print("done")
