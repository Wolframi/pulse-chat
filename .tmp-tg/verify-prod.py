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
    timeout=40,
)


def run(cmd: str) -> None:
    print(">>>", cmd, flush=True)
    _stdin, stdout, stderr = c.exec_command(cmd, timeout=40)
    sys.stdout.write(stdout.read().decode("utf-8", "replace"))
    sys.stdout.write(stderr.read().decode("utf-8", "replace"))
    print("exit", stdout.channel.recv_exit_status(), flush=True)
    print(flush=True)


run("pm2 status")
run("systemctl is-active pulse-auto-update.timer")
run("tail -n 20 /var/log/pulse-auto-update.log 2>/dev/null || echo NO_LOG")
run(
    "cd /root/pulse-chat && git log -1 --format='%h %s' && "
    "test -f .next/BUILD_ID && echo BUILD_ID=$(cat .next/BUILD_ID) || echo NO_BUILD_ID"
)
run("curl -sS -m 8 http://127.0.0.1:3000/api/health || echo HEALTH_FAIL")
c.close()
