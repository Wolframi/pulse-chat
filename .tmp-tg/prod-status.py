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
_stdin, stdout, stderr = c.exec_command(
    "ps aux --sort=-pcpu | head -n 15; echo '---'; "
    "pgrep -af 'npm|node|tsx' | head -n 20; echo '---'; "
    "test -f /root/pulse-chat/node_modules/next/package.json && echo NEXT_OK || echo NEXT_MISSING; "
    "ls /root/pulse-chat/.next/BUILD_ID 2>/dev/null || echo NO_BUILD_ID; "
    "nproc; uptime; free -m | head -n 2",
    timeout=30,
)
print(stdout.read().decode("utf-8", "replace"))
print(stderr.read().decode("utf-8", "replace"))
c.close()
