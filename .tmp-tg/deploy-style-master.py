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


run("systemctl stop pulse-auto-update.timer 2>/dev/null || true")
run("systemctl stop pulse-auto-update.service 2>/dev/null || true")
run("pkill -f pulse-auto-update.sh || true")
run("pm2 stop pulse-chat")
run("pkill -f 'next build' || true")
run("rm -f /root/pulse-chat/.next/lock")
run(
    "cd /root/pulse-chat && git fetch origin master && git checkout -f master && git reset --hard origin/master && git log -1 --oneline"
)
run(
    "cp -f /root/pulse-chat/scripts/auto-update.sh /usr/local/sbin/pulse-auto-update.sh && chmod +x /usr/local/sbin/pulse-auto-update.sh"
)
run(
    "cd /root/pulse-chat && test -x node_modules/.bin/next && test -d node_modules/react && echo DEPS_OK || NODE_OPTIONS=--max-old-space-size=1024 npm ci",
    timeout=600,
)
code = run(
    "cd /root/pulse-chat && NODE_OPTIONS=--max-old-space-size=1536 ./node_modules/.bin/next build",
    timeout=720,
)
run(
    "test -f /root/pulse-chat/.next/BUILD_ID && echo BUILD_OK && cat /root/pulse-chat/.next/BUILD_ID || echo BUILD_MISSING"
)
if code != 0:
    print("BUILD_FAILED skip restart", flush=True)
    c.close()
    raise SystemExit(1)
run("pm2 restart pulse-chat --update-env")
run("sleep 12; pm2 status; curl -fsS http://127.0.0.1:3000/api/health; echo")
run("cd /root/pulse-chat && git log -1 --oneline")
run("systemctl start pulse-auto-update.timer 2>/dev/null || true")
c.close()
raise SystemExit(0)
