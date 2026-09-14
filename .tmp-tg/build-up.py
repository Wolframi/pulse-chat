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


def run(cmd: str, timeout: int = 120) -> int:
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
    return code


run("pm2 stop pulse-chat")
run("test -x /root/pulse-chat/node_modules/.bin/tsx && echo TSX_OK || echo TSX_MISSING")
code = run(
    "cd /root/pulse-chat && NODE_OPTIONS=--max-old-space-size=1536 npx next build --webpack",
    timeout=700,
)
if code != 0:
    print("webpack build failed, trying npm run build -- --webpack")
    run(
        "cd /root/pulse-chat && NODE_OPTIONS=--max-old-space-size=1536 npm run build -- --webpack",
        timeout=700,
    )
run("test -f /root/pulse-chat/.next/BUILD_ID && echo BUILD_OK || echo BUILD_MISSING")
run("pm2 restart pulse-chat")
run("sleep 8; pm2 status")
run("curl -sS -m 12 http://127.0.0.1:3000/api/health || true")
run("pm2 logs pulse-chat --err --lines 15 --nostream")
c.close()
