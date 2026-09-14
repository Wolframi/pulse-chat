import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
t = c.get_transport()
if t:
    t.set_keepalive(15)


def run(cmd: str, timeout: int = 60) -> tuple[int, str]:
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


run("uptime; free -h; swapon --show; df -h / | tail -1")
run("pm2 status")
run(
    "test -f /root/pulse-chat/.next/BUILD_ID && echo BUILD_OK || echo BUILD_MISSING; "
    "test -x /root/pulse-chat/node_modules/.bin/tsx && echo TSX_OK || echo TSX_MISSING; "
    "test -d /root/pulse-chat/node_modules/next && echo NEXT_OK || echo NEXT_MISSING; "
    "test -f /root/pulse-chat/package.json && python3 - <<'PY'\n"
    "import json\n"
    "print('version', json.load(open('/root/pulse-chat/package.json'))['version'])\n"
    "PY"
)
run("curl -sS -m 8 http://127.0.0.1:3000/api/health || echo LOCAL_HEALTH_FAIL")
c.close()
